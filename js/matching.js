import { calculateDistance } from "./utils.js";
import { APP_CONFIG } from "./config.js";

const ISSUE_PROFESSION_HINTS = {
    "medical-emergency": ["medical"],
    "road-accident": ["medical", "driver", "rescue"],
    "fire-response": ["rescue", "medical", "driver"],
    "flood-relief": ["rescue", "logistics", "driver"],
    "food-distribution": ["logistics", "driver", "social-worker"],
    "water-shortage": ["logistics", "driver"],
    "elderly-support": ["medical", "social-worker"],
    "child-support": ["teacher", "social-worker", "medical"],
    "missing-person": ["rescue", "social-worker"],
    "blood-donation": ["medical", "social-worker"],
    "rescue-evacuation": ["rescue", "driver", "medical"],
    "shelter-support": ["logistics", "social-worker", "driver"]
};
const PLATFORM_MIN_VOLUNTEER_AGE = 18;

function parseNumber(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
    if (typeof value === "string") {
        const parsed = Number.parseFloat(value.trim());
        return Number.isFinite(parsed) ? parsed : NaN;
    }
    return NaN;
}

function normalizeText(value) {
    return String(value || "").trim().toLowerCase();
}

function normalizeSkills(values) {
    if (!Array.isArray(values)) return [];
    return values
        .map((skill) => normalizeText(skill))
        .filter(Boolean);
}

function getIssueMinAge(issue) {
    const direct = parseNumber(issue?.required_age_min);
    if (Number.isFinite(direct) && direct > 0) return Math.max(PLATFORM_MIN_VOLUNTEER_AGE, direct);

    const legacyFlat = parseNumber(issue?.min_age ?? issue?.minimum_age ?? issue?.age_min);
    if (Number.isFinite(legacyFlat) && legacyFlat > 0) return Math.max(PLATFORM_MIN_VOLUNTEER_AGE, legacyFlat);

    const nested = parseNumber(
        issue?.eligibility?.minAge ??
        issue?.eligibility?.minimumAge ??
        issue?.eligibility?.required_age_min
    );
    if (Number.isFinite(nested) && nested > 0) return Math.max(PLATFORM_MIN_VOLUNTEER_AGE, nested);

    return PLATFORM_MIN_VOLUNTEER_AGE;
}

function isVolunteerEligible(issue, volunteer) {
    const minAge = getIssueMinAge(issue);
    if (Number.isFinite(minAge) && minAge > 0) {
        const age = parseNumber(volunteer.age);
        if (!Number.isFinite(age) || age < minAge) return false;
    }

    const requiredLanguage = normalizeText(issue.required_language);
    if (requiredLanguage && requiredLanguage !== "any") {
        const volunteerLanguage = normalizeText(volunteer.language);
        if (!volunteerLanguage || volunteerLanguage !== requiredLanguage) return false;
    }

    const minExperienceYears = parseNumber(issue.required_experience_years);
    if (Number.isFinite(minExperienceYears) && minExperienceYears > 0) {
        const experienceYears = parseNumber(volunteer.experience_years);
        if (!Number.isFinite(experienceYears) || experienceYears < minExperienceYears) return false;
    }

    const requiredProfession = normalizeText(issue.required_profession);
    if (requiredProfession && requiredProfession !== "any") {
        const volunteerProfession = normalizeText(volunteer.profession);
        if (!volunteerProfession || volunteerProfession !== requiredProfession) return false;
    }

    const requiredSkills = normalizeSkills(issue.required_skills);
    if (requiredSkills.length) {
        const volunteerSkills = new Set(normalizeSkills(volunteer.skills));
        if (!requiredSkills.every((skill) => volunteerSkills.has(skill))) return false;
    }

    return true;
}

function scoreDistance(distanceKm) {
    if (distanceKm < 2) return 100;
    if (distanceKm < 5) return 85;
    if (distanceKm < 10) return 65;
    if (distanceKm < APP_CONFIG.matchingRadius) return 45;
    return 0;
}

function scoreAvailability(status) {
    const map = { online: 100, soon: 70, later: 35, offline: 0 };
    return map[status] ?? 0;
}

function scoreAge(issue, volunteer) {
    const minAge = getIssueMinAge(issue);
    const age = parseNumber(volunteer.age);
    if (!Number.isFinite(minAge) || minAge <= 0) return 100;
    if (!Number.isFinite(age)) return 0;
    return age >= minAge ? 100 : 0;
}

function scoreLanguage(issue, volunteer) {
    const needed = normalizeText(issue.required_language || "any");
    const volunteerLang = normalizeText(volunteer.language);
    if (!needed || needed === "any") return 100;
    if (!volunteerLang) return 20;
    return volunteerLang === needed ? 100 : 0;
}

function scoreExperience(issue, volunteer) {
    const minYears = parseNumber(issue.required_experience_years);
    const years = parseNumber(volunteer.experience_years);
    if (!Number.isFinite(minYears) || minYears <= 0) return 100;
    if (!Number.isFinite(years)) return 0;
    if (years >= minYears) return 100;
    if (years >= Math.max(0, minYears - 1)) return 65;
    return 20;
}

function scoreProfession(issue, volunteer) {
    const requiredProfession = normalizeText(issue.required_profession || "any");
    const volunteerProfession = normalizeText(volunteer.profession);

    if (requiredProfession && requiredProfession !== "any") {
        if (!volunteerProfession) return 20;
        return volunteerProfession === requiredProfession ? 100 : 0;
    }

    const hints = ISSUE_PROFESSION_HINTS[issue.category] || [];
    if (!hints.length) return 60;
    return hints.includes(volunteerProfession) ? 100 : 50;
}

function scoreSkills(issue, volunteer) {
    const required = normalizeSkills(issue.required_skills);
    const provided = normalizeSkills(volunteer.skills);
    if (!required.length) return 100;
    if (!provided.length) return 0;

    const req = new Set(required);
    const prov = new Set(provided);
    if (!req.size) return 100;

    let matched = 0;
    req.forEach((skill) => {
        if (prov.has(skill)) {
            matched += 1;
            return;
        }
        for (const own of prov) {
            if (own.includes(skill) || skill.includes(own)) {
                matched += 0.6;
                break;
            }
        }
    });
    return Math.min(100, Math.round((matched / req.size) * 100));
}

function scoreReliability(volunteer) {
    const completedTasks = Number(volunteer.completed_tasks || 0);
    const rating = Number(volunteer.rating || 5);
    return Math.min(100, Math.max(40, completedTasks * 4 + rating * 12));
}

export function matchVolunteers(issue, volunteers, topN = 8) {
    const scoredVolunteers = [];
    if (!issue?.location || !Array.isArray(volunteers)) return scoredVolunteers;

    for (const volunteer of volunteers) {
        if (!volunteer?.location) continue;
        if (!isVolunteerEligible(issue, volunteer)) continue;
        const distanceKm = calculateDistance(
            issue.location.lat,
            issue.location.lng,
            volunteer.location.lat,
            volunteer.location.lng
        );
        if (distanceKm > APP_CONFIG.matchingRadius) continue;

        const score = (
            scoreDistance(distanceKm) * 0.28 +
            scoreAvailability(volunteer.availability) * 0.14 +
            scoreAge(issue, volunteer) * 0.14 +
            scoreLanguage(issue, volunteer) * 0.14 +
            scoreExperience(issue, volunteer) * 0.12 +
            scoreProfession(issue, volunteer) * 0.08 +
            scoreSkills(issue, volunteer) * 0.14 +
            scoreReliability(volunteer) * 0.06
        );

        if (score <= 0) continue;
        scoredVolunteers.push({
            ...volunteer,
            distanceKm,
            matchScore: Number(score.toFixed(2))
        });
    }

    return scoredVolunteers
        .sort((a, b) => b.matchScore - a.matchScore || a.distanceKm - b.distanceKm)
        .slice(0, topN);
}
