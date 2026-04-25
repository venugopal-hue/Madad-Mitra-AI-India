import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import {
    collection,
    addDoc,
    getDocs,
    query,
    where,
    deleteDoc,
    doc,
    getDoc,
    updateDoc
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { auth, db } from "./config.js";

const logEl = document.getElementById("seed-log");

const ISSUE_IMAGES = [
    "https://images.unsplash.com/photo-1526256262350-7da7584cf5eb?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1469571486292-b53601020f14?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1511632765486-a01980e01a18?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1532629345422-7515f3d16bb8?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1517048676732-d65bc937f952?auto=format&fit=crop&w=1200&q=80"
];

let currentUser = null;

function log(message) {
    const ts = new Date().toLocaleTimeString();
    logEl.innerHTML += `\n[${ts}] ${message}`;
    logEl.scrollTop = logEl.scrollHeight;
}

function isoMinutesAgo(minutes) {
    return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

async function deleteCollectionDocs(collectionName) {
    const snap = await getDocs(collection(db, collectionName));
    for (const d of snap.docs) {
        await deleteDoc(doc(db, collectionName, d.id));
    }
    log(`Cleared ${collectionName}: ${snap.size} docs`);
}

async function ensureVolunteerProfiles() {
    const volQuery = query(collection(db, "users"), where("role", "==", "volunteer"));
    const snap = await getDocs(volQuery);
    for (const d of snap.docs) {
        const patch = {};
        const data = d.data();
        if (!data.location) patch.location = { lat: 28.6139, lng: 77.2090 };
        if (!data.availability) patch.availability = "online";
        if (!data.skills) patch.skills = ["First Aid", "Logistics"];
        if (!data.age) patch.age = 24;
        if (!data.completed_tasks) patch.completed_tasks = Math.floor(Math.random() * 14) + 1;
        if (!data.rating) patch.rating = Number((4 + Math.random()).toFixed(1));
        if (!data.language) patch.language = "hindi";
        if (!data.profession) patch.profession = "social-worker";
        if (!data.experience_years) patch.experience_years = Math.floor(Math.random() * 6);
        if (Object.keys(patch).length) await updateDoc(doc(db, "users", d.id), patch);
    }
    log(`Volunteer profiles prepared: ${snap.size}`);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function resetVolunteersToFreshState() {
    const volQuery = query(collection(db, "users"), where("role", "==", "volunteer"));
    const snap = await getDocs(volQuery);
    let removedTestProfiles = 0;
    let resetProfiles = 0;

    for (const d of snap.docs) {
        const data = d.data() || {};
        const name = String(data.name || "").toLowerCase();
        const email = String(data.email || "").toLowerCase();
        const looksLikeTestProfile =
            name.includes("test") ||
            name.includes("demo") ||
            name.includes("sample") ||
            email.includes("test") ||
            email.includes("demo") ||
            email.includes("sample");

        if (looksLikeTestProfile) {
            await deleteDoc(doc(db, "users", d.id));
            removedTestProfiles += 1;
            continue;
        }

        await updateDoc(doc(db, "users", d.id), {
            completed_tasks: 0,
            rating: 5.0,
            availability: data.availability || "online"
        });
        resetProfiles += 1;
    }
    log(`Volunteer stats reset: ${resetProfiles}`);
    log(`Test volunteer profiles removed: ${removedTestProfiles}`);
}

async function buildAndInsertScenario(user) {
    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (!userDoc.exists()) throw new Error("User profile missing in users collection.");
    const me = userDoc.data();

    const volunteers = await ensureVolunteerProfiles();
    const onlineVolunteers = volunteers.filter((v) => v.availability === "online");
    const volunteerIds = onlineVolunteers.map((v) => v.id);

    if (!volunteerIds.length) {
        throw new Error("No online volunteers found. Set at least one volunteer to online and retry.");
    }

    const issues = [
        {
            title: "Medical Support At Community Camp",
            description: "Urgent medical assistance needed for dehydration and minor injuries.",
            category: "medical-emergency",
            urgency_tag: "high",
            status: "pending",
            required_age_min: 21,
            required_language: "hindi",
            required_experience_years: 1,
            required_profession: "medical",
            required_skills: ["first aid"],
            location: { lat: 28.6139, lng: 77.2090 },
            image_url: ISSUE_IMAGES[0],
            created_at: isoMinutesAgo(18),
            accepted_volunteer: null
        },
        {
            title: "Rapid Food Distribution Drive",
            description: "Volunteers needed to organize and distribute meal packets.",
            category: "food-distribution",
            urgency_tag: "medium",
            status: "in-progress",
            required_age_min: 18,
            required_language: "any",
            required_experience_years: 0,
            required_profession: "logistics",
            required_skills: ["logistics"],
            location: { lat: 28.621, lng: 77.216 },
            image_url: ISSUE_IMAGES[1],
            created_at: isoMinutesAgo(46),
            accepted_volunteer: volunteerIds[0],
            accepted_at: isoMinutesAgo(35)
        },
        {
            title: "Relief Shelter Coordination",
            description: "Support required for registration and supply distribution at shelter.",
            category: "shelter-support",
            urgency_tag: "high",
            status: "under-review",
            required_age_min: 20,
            required_language: "english",
            required_experience_years: 1,
            required_profession: "social-worker",
            required_skills: ["coordination"],
            location: { lat: 28.628, lng: 77.205 },
            image_url: ISSUE_IMAGES[2],
            created_at: isoMinutesAgo(90),
            accepted_volunteer: volunteerIds[1] || volunteerIds[0],
            accepted_at: isoMinutesAgo(72),
            submitted_for_review_at: isoMinutesAgo(20),
            proof_timestamp: isoMinutesAgo(20),
            proof_url: ISSUE_IMAGES[3],
            resolution_seconds: 3120
        },
        {
            title: "Water Refill Point Assistance",
            description: "Queue handling and quick refill operations at temporary station.",
            category: "water-shortage",
            urgency_tag: "low",
            status: "completed",
            required_age_min: 18,
            required_language: "any",
            required_experience_years: 0,
            required_profession: "any",
            required_skills: [],
            location: { lat: 28.607, lng: 77.195 },
            image_url: ISSUE_IMAGES[4],
            created_at: isoMinutesAgo(220),
            accepted_volunteer: volunteerIds[2] || volunteerIds[0],
            accepted_at: isoMinutesAgo(190),
            submitted_for_review_at: isoMinutesAgo(160),
            proof_timestamp: isoMinutesAgo(160),
            proof_url: ISSUE_IMAGES[5],
            resolution_seconds: 1820
        }
    ];

    const createdIssueRefs = [];
    for (const issue of issues) {
        const ref = await addDoc(collection(db, "issues"), {
            ...issue,
            ngo_id: user.uid,
            ngo_name: me.name || "Relief NGO",
            ngo_code: me.unique_code || "MM-1001",
            ngo_contact: me.contact || "contact@ngo.org",
            ocr_details: ""
        });
        createdIssueRefs.push({ id: ref.id, data: issue });
    }
    log(`Inserted issues: ${createdIssueRefs.length}`);

    for (const it of createdIssueRefs) {
        const potentials = volunteerIds.slice(0, Math.min(4, volunteerIds.length));
        const scoreMap = {};
        potentials.forEach((id, idx) => {
            scoreMap[id] = 92 - idx * 6;
        });
        await addDoc(collection(db, "assignments"), {
            issue_id: it.id,
            potential_volunteers: potentials,
            notified_volunteers: potentials,
            eligibility_scores: scoreMap,
            status: it.data.status === "pending" ? "pending_acceptance" : "accepted",
            accepted_volunteer: it.data.accepted_volunteer || null,
            created_at: it.data.created_at
        });
    }
    log(`Inserted assignments: ${createdIssueRefs.length}`);

    const topVol = volunteerIds[0];
    if (topVol) {
        const issue0 = createdIssueRefs[0];
        await addDoc(collection(db, "notifications"), {
            volunteer_id: topVol,
            issue_id: issue0.id,
            issue_title: issue0.data.title,
            issue_category: issue0.data.category,
            message: `You are matched for ${issue0.data.title}.`,
            match_score: 96.5,
            unread: true,
            created_at: isoMinutesAgo(10)
        });
        log("Inserted notifications: 1");
    }

    await addDoc(collection(db, "global_alerts"), {
        message: "City support unit active in North Zone. Coordinate nearest response teams.",
        sender: me.name || "Relief Command",
        created_at: isoMinutesAgo(14),
        type: "emergency",
        active: true
    });
    log("Inserted global alerts: 1");
}

async function resetAndLoadScenario() {
    if (!currentUser) {
        log("Login required. Open this page after signing in.");
        return;
    }
    logEl.textContent = "";

    try {
        log("Starting reset...");
        await deleteCollectionDocs("notifications");
        await deleteCollectionDocs("assignments");
        await deleteCollectionDocs("issues");
        await deleteCollectionDocs("global_alerts");
        log("Loading fresh scenario...");
        await buildAndInsertScenario(currentUser);
        log("Scenario loaded successfully.");
    } catch (err) {
        log(`Error: ${err.message}`);
    }
}

async function resetToFreshStart() {
    if (!currentUser) {
        log("Login required. Open this page after signing in.");
        return;
    }

    logEl.textContent = "";

    try {
        log("Starting fresh reset...");
        await deleteCollectionDocs("notifications");
        await deleteCollectionDocs("assignments");
        await deleteCollectionDocs("issues");
        await deleteCollectionDocs("global_alerts");
        await resetVolunteersToFreshState();
        log("Fresh start ready. No completed/cancelled or historical issue data remains.");
    } catch (err) {
        log(`Error: ${err.message}`);
    }
}

let resetRan = false;
onAuthStateChanged(auth, async (user) => {
    currentUser = user || null;
    if (currentUser) {
        log(`Signed in as ${currentUser.email || currentUser.uid}`);
        if (!resetRan) {
            resetRan = true;
            await resetToFreshStart();
        }
    } else {
        log("No active session. Please sign in first from the app.");
    }
});
