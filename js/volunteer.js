import { onAuthStateChanged, signOut, updatePassword } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import { doc, getDoc, updateDoc, collection, query, where, onSnapshot, getDocs, addDoc } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { auth, db } from "./config.js";

let map, currentVolunteer = null;
let markers = {};
let activeTaskTimers = new Map();

// UI Elements
const volName = document.getElementById('vol-name');
const volRating = document.getElementById('vol-rating');
const volStatus = document.getElementById('vol-status');
const requestList = document.getElementById('request-list');
const activeTaskList = document.getElementById('active-task-list');
const reviewTaskList = document.getElementById('review-task-list');
const pastTaskList = document.getElementById('past-task-list');
const ignoredTaskList = document.getElementById('ignored-task-list');
const notificationBar = document.getElementById('notification-bar');
const aiStatusToast = document.getElementById('ai-status-toast');
const aiStatusText = document.getElementById('ai-status-text');
const locateMeBtn = document.getElementById('locate-me-btn');
const volStreakCount = document.getElementById('vol-streak-count');
const volNextStreak = document.getElementById('vol-next-streak');
const streakHelperText = document.getElementById('streak-helper-text');
const leaderboardList = document.getElementById('leaderboard-list');
const openReportModalBtn = document.getElementById('open-report-modal-btn');
const reportModal = document.getElementById('report-modal');
const closeReportModalBtn = document.getElementById('close-report-modal');
const reportIssueForm = document.getElementById('report-issue-form');

// Profile UI Elements
const tabTasks = document.getElementById('tab-tasks');
const tabProfile = document.getElementById('tab-profile');
const taskView = document.getElementById('task-view');
const profileView = document.getElementById('profile-view');
const editPhone = document.getElementById('edit-phone');
const editEmail = document.getElementById('edit-email');
const editSkills = document.getElementById('edit-skills');
const editAge = document.getElementById('edit-age');
const editExperience = document.getElementById('edit-experience');
const editLanguage = document.getElementById('edit-language');
const editProfession = document.getElementById('edit-profession');
const updateProfileBtn = document.getElementById('update-profile-btn');
const changePasswordBtn = document.getElementById('change-password-btn');
const newPasswordInput = document.getElementById('new-password');

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = 'index.html';
        return;
    }

    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (userDoc.exists() && userDoc.data().role === 'volunteer') {
        currentVolunteer = { id: user.uid, ...userDoc.data() };
        setupDashboard();
        setupIssueReportFlow();
        listenToLeaderboard();
        startLocationTracking();
        listenToRequests();
        listenToActiveTasks();
        listenToReviewTasks();
        listenToPastTasks();
        listenToIgnoredTasks();
        setupProfileCenter();
        startPulseAnimation();
        listenToGlobalAlerts();
        listenToEligibilityNotifications();

        setInterval(() => {
            if ("geolocation" in navigator) {
                navigator.geolocation.getCurrentPosition((position) => {
                    updateVolunteerLocation(position.coords.latitude, position.coords.longitude);
                });
            }
            startPulseAnimation();
        }, 10000);
    } else {
        window.location.href = 'index.html';
    }
});

function startPulseAnimation() {
    const pulseBar = document.getElementById('pulse-bar');
    const pulseTimer = document.getElementById('pulse-timer');
    if (!pulseBar || !pulseTimer) return;
    
    pulseBar.style.transition = 'none';
    pulseBar.style.width = '0%';
    void pulseBar.offsetWidth;
    pulseBar.style.transition = 'width 10s linear';
    pulseBar.style.width = '100%';
    
    pulseTimer.textContent = "Syncing...";
    setTimeout(() => { if(pulseTimer) pulseTimer.textContent = "Connected"; }, 9000);
}

function setupDashboard() {
    volName.textContent = currentVolunteer.name || "Volunteer";
    volRating.textContent = `TASKS ${currentVolunteer.completed_tasks || 0}`;
    volStatus.value = currentVolunteer.availability || 'online';
    updateGamificationPanel(currentVolunteer.completed_tasks || 0);

    if (!map) {
        // Add small delay to ensure DOM is fully rendered on mobile
        setTimeout(() => {
            map = L.map('map').setView([28.6139, 77.2090], 13);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
            
            // Fix map display on mobile resize
            window.addEventListener('resize', () => {
                if (map) map.invalidateSize();
            });
        }, 100);
    }

    volStatus.onchange = async () => {
        await updateDoc(doc(db, "users", auth.currentUser.uid), {
            availability: volStatus.value
        });
    };
}

function computeStreakStats(completedTasksRaw) {
    const completedTasks = Number(completedTasksRaw || 0);
    const safeCompleted = Number.isFinite(completedTasks) ? Math.max(0, completedTasks) : 0;
    const streaks = Math.floor(safeCompleted / 5);
    const progress = safeCompleted % 5;
    const remaining = progress === 0 ? 5 : 5 - progress;
    return { streaks, remaining, safeCompleted };
}

function updateGamificationPanel(completedTasksRaw) {
    const { streaks, remaining, safeCompleted } = computeStreakStats(completedTasksRaw);
    if (volRating) volRating.textContent = `TASKS ${safeCompleted}`;
    if (volStreakCount) volStreakCount.textContent = String(streaks);
    if (volNextStreak) volNextStreak.textContent = String(remaining);
    if (streakHelperText) {
        streakHelperText.textContent = streaks > 0
            ? `${safeCompleted} issues resolved. Keep going for your next streak.`
            : "Complete 5 issues to unlock your first streak.";
    }
}

function listenToLeaderboard() {
    const q = query(collection(db, "users"), where("role", "==", "volunteer"));
    onSnapshot(q, (snap) => {
        const ranked = snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => {
                const taskDiff = Number(b.completed_tasks || 0) - Number(a.completed_tasks || 0);
                if (taskDiff !== 0) return taskDiff;
                return Number(b.rating || 0) - Number(a.rating || 0);
            })
            .slice(0, 8);

        const me = ranked.find((v) => v.id === auth.currentUser.uid);
        if (me) updateGamificationPanel(me.completed_tasks || 0);

        if (!leaderboardList) return;
        if (!ranked.length) {
            leaderboardList.innerHTML = '<p style="font-size:0.78rem;color:var(--text-muted);">No volunteers ranked yet.</p>';
            return;
        }

        leaderboardList.innerHTML = ranked.map((vol, index) => {
            const { streaks } = computeStreakStats(vol.completed_tasks || 0);
            const rankLabel = `#${index + 1}`;
            const isMe = vol.id === auth.currentUser.uid;
            return `
                <div class="glass" style="padding: 10px 12px; border-radius: 10px; border: 1px solid ${isMe ? 'rgba(59,130,246,0.45)' : 'rgba(255,255,255,0.08)'};">
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                        <span style="font-size:0.76rem; color:var(--text-muted); font-weight:700;">${rankLabel}</span>
                        <span style="flex:1; min-width:0; font-size:0.84rem; color:white; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${vol.name || 'Volunteer'}</span>
                        <span style="font-size:0.78rem; color:var(--secondary); font-weight:700;">${Number(vol.completed_tasks || 0)} issues</span>
                    </div>
                    <p style="font-size:0.72rem; color:var(--text-muted); margin-top:5px;">Streaks: ${streaks}</p>
                </div>
            `;
        }).join('');
    });
}

function setupProfileCenter() {
    editPhone.value = currentVolunteer.phone || '';
    editEmail.value = auth.currentUser.email;
    editSkills.value = (currentVolunteer.skills || []).join(', ');
    editAge.value = currentVolunteer.age || '';
    editExperience.value = currentVolunteer.experience_years || '';
    editLanguage.value = currentVolunteer.language || '';
    editProfession.value = currentVolunteer.profession || '';

    tabTasks.onclick = () => {
        taskView.style.display = 'block';
        profileView.style.display = 'none';
        tabTasks.className = 'btn btn-primary';
        tabProfile.className = 'btn btn-secondary';
    };

    tabProfile.onclick = () => {
        taskView.style.display = 'none';
        profileView.style.display = 'flex';
        tabTasks.className = 'btn btn-secondary';
        tabProfile.className = 'btn btn-primary';
    };

    updateProfileBtn.onclick = async () => {
        const skills = editSkills.value.split(',').map(s => s.trim()).filter(s => s !== "");
        const phone = editPhone.value;
        const age = Number.parseInt(editAge.value, 10);
        const experienceYears = Number.parseInt(editExperience.value, 10);
        const language = (editLanguage.value || "").trim().toLowerCase();
        const profession = (editProfession.value || "").trim().toLowerCase();
        try {
            await updateDoc(doc(db, "users", auth.currentUser.uid), {
                skills,
                phone,
                age: Number.isNaN(age) ? null : age,
                experience_years: Number.isNaN(experienceYears) ? 0 : experienceYears,
                language: language || null,
                profession: profession || null
            });
            setAIStatus("Profile updated.", false);
        } catch (e) {
            setAIStatus("Profile update failed: " + e.message, false);
        }
        setTimeout(() => aiStatusToast.style.display = 'none', 2500);
    };

    changePasswordBtn.onclick = async () => {
        const newPass = newPasswordInput.value;
        if (newPass.length < 6) {
            setAIStatus("Password must be at least 6 characters.", false);
            setTimeout(() => aiStatusToast.style.display = 'none', 2500);
            return;
        }
        try {
            await updatePassword(auth.currentUser, newPass);
            setAIStatus("Password updated.", false);
            newPasswordInput.value = '';
        } catch (e) {
            setAIStatus("Password update failed: " + e.message, false);
        }
        setTimeout(() => aiStatusToast.style.display = 'none', 2500);
    };
}

function getCurrentVolunteerLocation() {
    if (markers['me']) {
        const mePos = markers['me'].getLatLng();
        if (mePos) return { lat: mePos.lat, lng: mePos.lng };
    }
    if (currentVolunteer?.location) return currentVolunteer.location;
    return null;
}

function setupIssueReportFlow() {
    if (openReportModalBtn && reportModal) {
        openReportModalBtn.onclick = () => {
            reportModal.style.display = 'flex';
        };
    }

    if (closeReportModalBtn && reportModal) {
        closeReportModalBtn.onclick = () => {
            reportModal.style.display = 'none';
        };
    }

    if (reportModal) {
        reportModal.onclick = (e) => {
            if (e.target === reportModal) reportModal.style.display = 'none';
        };
    }

    if (reportIssueForm) {
        reportIssueForm.onsubmit = async (e) => {
            e.preventDefault();
            const location = getCurrentVolunteerLocation();
            if (!location) {
                setAIStatus("Location unavailable. Please allow location access and try again.", false);
                setTimeout(() => aiStatusToast.style.display = 'none', 3000);
                return;
            }

            const title = document.getElementById('report-title').value.trim();
            const description = document.getElementById('report-description').value.trim();
            const category = document.getElementById('report-category').value;
            const urgency = document.getElementById('report-urgency').value;

            setAIStatus("Sending issue report to NGO review...", true);
            try {
                await addDoc(collection(db, "volunteer_reports"), {
                    title,
                    description,
                    category,
                    urgency_tag: urgency,
                    location,
                    status: "pending_review",
                    reporter_id: auth.currentUser.uid,
                    reporter_name: currentVolunteer?.name || "Volunteer",
                    reporter_phone: currentVolunteer?.phone || null,
                    created_at: new Date().toISOString()
                });
                reportIssueForm.reset();
                if (reportModal) reportModal.style.display = 'none';
                setAIStatus("Issue reported successfully. NGO team will review it shortly.", false);
            } catch (err) {
                setAIStatus("Report failed: " + err.message, false);
            }
            setTimeout(() => aiStatusToast.style.display = 'none', 3000);
        };
    }
}

window.addSkill = (skill) => {
    const current = editSkills.value.split(',').map(s => s.trim()).filter(s => s !== "");
    if (!current.includes(skill)) {
        current.push(skill);
        editSkills.value = current.join(', ');
    }
};

function startLocationTracking() {
    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition((pos) => {
            map.setView([pos.coords.latitude, pos.coords.longitude], 14);
            updateVolunteerLocation(pos.coords.latitude, pos.coords.longitude);
        });
        navigator.geolocation.watchPosition((pos) => {
            updateVolunteerLocation(pos.coords.latitude, pos.coords.longitude);
        });
    }
}

async function updateVolunteerLocation(lat, lng) {
    if (!currentVolunteer) return;
    currentVolunteer.location = { lat, lng };
    await updateDoc(doc(db, "users", auth.currentUser.uid), { location: { lat, lng } });
    if (markers['me']) map.removeLayer(markers['me']);
    
    const icon = L.divIcon({
        className: 'custom-icon',
        html: `
            <div style="position: relative; width: 20px; height: 20px;">
                <div class="pulse" style="position: absolute; width: 100%; height: 100%; background: #10b981; border-radius: 50%; opacity: 0.4;"></div>
                <div style="position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; background: #10b981; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 10px #10b981;"></div>
            </div>
        `,
        iconSize: [20, 20], iconAnchor: [10, 10]
    });
    markers['me'] = L.marker([lat, lng], { icon }).addTo(map).bindPopup("You are here");
}

let issueListeners = new Map();
const seenNotificationIds = new Set();
const PLATFORM_MIN_VOLUNTEER_AGE = 18;

function parseEligibilityNumber(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
    if (typeof value === "string") {
        const parsed = Number.parseFloat(value.trim());
        return Number.isFinite(parsed) ? parsed : NaN;
    }
    return NaN;
}

function getIssueMinAge(issue) {
    const direct = parseEligibilityNumber(issue?.required_age_min);
    if (Number.isFinite(direct) && direct > 0) return Math.max(PLATFORM_MIN_VOLUNTEER_AGE, direct);

    const legacyFlat = parseEligibilityNumber(issue?.min_age ?? issue?.minimum_age ?? issue?.age_min);
    if (Number.isFinite(legacyFlat) && legacyFlat > 0) return Math.max(PLATFORM_MIN_VOLUNTEER_AGE, legacyFlat);

    const nested = parseEligibilityNumber(
        issue?.eligibility?.minAge ??
        issue?.eligibility?.minimumAge ??
        issue?.eligibility?.required_age_min
    );
    if (Number.isFinite(nested) && nested > 0) return Math.max(PLATFORM_MIN_VOLUNTEER_AGE, nested);

    return PLATFORM_MIN_VOLUNTEER_AGE;
}

function isVolunteerAgeEligibleForIssue(issue) {
    const minAge = getIssueMinAge(issue);
    if (!Number.isFinite(minAge) || minAge <= 0) return true;
    const volunteerAge = parseEligibilityNumber(currentVolunteer?.age);
    return Number.isFinite(volunteerAge) && volunteerAge >= minAge;
}

function refreshRequestIndicators() {
    const visibleCards = requestList.querySelectorAll("[id^='request-']").length;
    notificationBar.style.display = visibleCards > 0 ? 'flex' : 'none';
    if (visibleCards === 0) {
        requestList.innerHTML = '<p style="font-size:0.7rem;text-align:center;color:var(--text-muted);margin-top:20px;">No new requests.</p>';
    } else {
        const noReqText = requestList.querySelector('p');
        if (noReqText) noReqText.remove();
    }
}

function listenToRequests() {
    const q = query(collection(db, "assignments"), 
        where("potential_volunteers", "array-contains", auth.currentUser.uid), 
        where("status", "==", "pending_acceptance")
    );
    
    onSnapshot(q, (snap) => {
        const availableDocs = snap.docs.filter(d => !(d.data().ignored_by || []).includes(auth.currentUser.uid));
        const availableIds = availableDocs.map(d => d.id);
        const sortedDocs = [...availableDocs].sort((a, b) => {
            const aScore = (a.data().eligibility_scores || {})[auth.currentUser.uid] || 0;
            const bScore = (b.data().eligibility_scores || {})[auth.currentUser.uid] || 0;
            if (bScore !== aScore) return bScore - aScore;
            return new Date(b.data().created_at || 0) - new Date(a.data().created_at || 0);
        });

        // 1. Remove listeners and cards for assignments that are no longer active
        issueListeners.forEach((unsub, assignId) => {
            if (!availableIds.includes(assignId)) {
                unsub(); // Stop listening
                issueListeners.delete(assignId);
                const card = document.getElementById(`request-${assignId}`);
                if (card) card.remove();
            }
        });

        // 2. Add or update listeners for new/active assignments
        refreshRequestIndicators();

        sortedDocs.forEach((d) => {
            const assignId = d.id;
            const issueId = d.data().issue_id;
            
            if (!issueListeners.has(assignId)) {
                const unsub = onSnapshot(doc(db, "issues", issueId), (issueSnap) => {
                    if (issueSnap.exists()) {
                        const issueData = issueSnap.data();
                        let existingCard = document.getElementById(`request-${assignId}`);
                        if (!isVolunteerAgeEligibleForIssue(issueData)) {
                            if (existingCard) existingCard.remove();
                            refreshRequestIndicators();
                            return;
                        }
                        if (existingCard) existingCard.remove();
                        renderRequestCard(assignId, issueId, issueData, d.data());
                        refreshRequestIndicators();
                    }
                });
                issueListeners.set(assignId, unsub);
            }
        });
    });
}

function renderRequestCard(assignId, issueId, issue, assignment) {
    const card = document.createElement('div');
    card.id = `request-${assignId}`; // ID for removal/update
    card.className = 'card glass fade-in';
    card.style.padding = '12px';
    
    const img = issue.image_url ? `<img src="${issue.image_url}" style="width:100%;height:60px;object-fit:cover;border-radius:4px;margin-bottom:10px;cursor:pointer;" onclick="window.open('${issue.image_url}', '_blank')">` : "";

    const rawScore = Number((assignment?.eligibility_scores || {})[auth.currentUser.uid] || 0);
    const score = Number(rawScore.toFixed(1));
    card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
            <h4 style="font-size:0.85rem;">${issue.title}</h4>
            <span style="font-size:0.6rem; background:rgba(59,130,246,0.1); color:var(--primary); padding:2px 6px; border-radius:10px; font-weight:700;">FIT ${score}</span>
        </div>
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px;">
            <p style="font-size:0.65rem; color:var(--text-muted);">Posted by: <span style="color:var(--secondary); font-weight:600;">${issue.ngo_name || 'Helping NGO'}</span></p>
            <a href="tel:${issue.ngo_contact}" style="background:var(--secondary); color:white; width:22px; height:22px; border-radius:50%; display:flex; align-items:center; justify-content:center; text-decoration:none;">
                <i data-lucide="phone" style="width:12px; height:12px;"></i>
            </a>
        </div>
        ${img}
        <p style="font-size:0.65rem; color:var(--primary); margin-bottom:8px;">
            Type: ${(issue.category || "general").replaceAll("-", " ")} | Needs: ${issue.required_profession || "any"}, ${issue.required_language || "any"}
        </p>
        <p style="font-size:0.75rem; color:var(--text-muted); margin-bottom:10px;">${issue.description.substring(0, 50)}...</p>
        <div style="display:flex; gap:5px;">
            <button onclick="window.acceptAssignment('${assignId}', '${issueId}', '${issue.category}')" class="btn btn-primary" style="flex:1; padding:6px; font-size:0.75rem;">ACCEPT</button>
            <button onclick="window.ignoreAssignment('${assignId}', '${issueId}')" class="btn btn-secondary" style="flex:1; padding:6px; font-size:0.75rem;">IGNORE</button>
        </div>
    `;
    requestList.appendChild(card);
    lucide.createIcons();
}

window.acceptAssignment = async (assignId, issueId, category) => {
    const acceptedAt = new Date().toISOString();
    await updateDoc(doc(db, "assignments", assignId), {
        status: 'accepted',
        accepted_volunteer: auth.currentUser.uid,
        accepted_at: acceptedAt
    });
    await updateDoc(doc(db, "issues", issueId), {
        status: 'in-progress',
        accepted_volunteer: auth.currentUser.uid,
        accepted_at: acceptedAt
    });
    await markIssueNotificationsRead(issueId);
    if (window.showMissionPrep) window.showMissionPrep(category);
};

window.ignoreAssignment = async (assignId, issueId) => {
    const snap = await getDoc(doc(db, "assignments", assignId));
    const ignored = snap.data().ignored_by || [];
    ignored.push(auth.currentUser.uid);
    await updateDoc(doc(db, "assignments", assignId), { ignored_by: ignored });
    await markIssueNotificationsRead(issueId);
};

function listenToActiveTasks() {
    const q = query(collection(db, "issues"), where("accepted_volunteer", "==", auth.currentUser.uid), where("status", "in", ["in-progress", "assigned"]));
    onSnapshot(q, (snap) => {
        const activeIds = new Set(snap.docs.map((d) => d.id));
        Array.from(activeTaskTimers.keys()).forEach((taskId) => {
            if (!activeIds.has(taskId)) {
                const timerId = activeTaskTimers.get(taskId);
                clearInterval(timerId);
                activeTaskTimers.delete(taskId);
            }
        });
        activeTaskList.innerHTML = snap.empty ? '<p style="font-size:0.7rem;text-align:center;">No active tasks.</p>' : '';
        snap.forEach(d => renderActiveTaskCard(d.id, d.data()));
    });
}

function formatDuration(ms) {
    const safeMs = Math.max(0, Number(ms) || 0);
    const totalSeconds = Math.floor(safeMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function buildCompletionQuote(resolutionSeconds) {
    if (!Number.isFinite(resolutionSeconds)) {
        return "Brilliant effort! Proof submitted successfully.";
    }

    const sec = Math.max(0, Math.round(resolutionSeconds));
    if (sec <= 300) return `Wow! You completed the work in ${sec} secs. Lightning response!`;
    if (sec <= 900) return `Excellent work! You completed the work in ${sec} secs.`;
    return `Great dedication! You completed the work in ${sec} secs.`;
}

function startActiveTaskTimer(taskId, startedAtIso) {
    const existing = activeTaskTimers.get(taskId);
    if (existing) clearInterval(existing);

    const timerEl = document.getElementById(`timer-${taskId}`);
    const startedAtMs = Date.parse(startedAtIso || "");
    if (!timerEl || !Number.isFinite(startedAtMs)) {
        if (timerEl) timerEl.textContent = "Timer: start time unavailable";
        return;
    }

    const tick = () => {
        timerEl.textContent = `Elapsed: ${formatDuration(Date.now() - startedAtMs)}`;
    };

    tick();
    const intervalId = setInterval(tick, 1000);
    activeTaskTimers.set(taskId, intervalId);
}

function renderActiveTaskCard(id, issue) {
    const card = document.createElement('div');
    card.className = 'card glass';
    card.style.padding = '15px';
    card.style.borderLeft = '4px solid var(--primary)';
    
    const img = issue.image_url ? `<img src="${issue.image_url}" style="width:100%;height:80px;object-fit:cover;border-radius:4px;margin-bottom:10px;">` : "";

    card.innerHTML = `
        <div style="display:flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <h4 style="font-size:0.9rem; margin:0;">${issue.title}</h4>
            <button class="btn btn-primary" onclick="window.open('https://www.google.com/maps/dir/?api=1&destination=${issue.location.lat},${issue.location.lng}', '_blank')" style="padding: 5px 10px; font-size: 0.7rem; display: flex; align-items: center; gap: 5px;">
                <i data-lucide="navigation"></i> Navigate
            </button>
        </div>
        ${img}
        <div style="margin-bottom:10px; background: rgba(59,130,246,0.08); border: 1px solid rgba(59,130,246,0.25); border-radius: 8px; padding: 8px;">
            <p id="timer-${id}" style="font-size:0.72rem; color: var(--primary); font-weight:700; margin:0;">Timer: starting...</p>
        </div>
        <div class="input-group" style="margin:10px 0;">
            <label style="font-size:0.65rem;color:var(--primary);">Upload Proof Photo</label>
            <input type="file" id="proof-${id}" accept="image/*" style="font-size:0.7rem;">
        </div>
        <button onclick="window.submitForReview('${id}')" class="btn btn-primary" style="width:100%;font-size:0.8rem;">Submit for Review</button>
    `;
    activeTaskList.appendChild(card);
    const startedAt = issue.accepted_at || issue.started_at || issue.created_at || null;
    startActiveTaskTimer(id, startedAt);
    lucide.createIcons();
}

async function compressImage(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 500;
                let width = img.width;
                let height = img.height;
                if (width > MAX_WIDTH) {
                    height *= MAX_WIDTH / width;
                    width = MAX_WIDTH;
                }
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', 0.4));
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

window.submitForReview = async (id) => {
    const file = document.getElementById(`proof-${id}`).files[0];
    if (!file) {
        setAIStatus("Please upload a proof photo first.", false);
        setTimeout(() => aiStatusToast.style.display = 'none', 2500);
        return;
    }

    setAIStatus("Compressing proof (Free Mode)...", true);
    
    try {
        const issueRef = doc(db, "issues", id);
        const issueSnap = await getDoc(issueRef);
        const issueData = issueSnap.exists() ? issueSnap.data() : {};
        const acceptedAtMs = Date.parse(issueData.accepted_at || issueData.started_at || "");
        const submittedAtIso = new Date().toISOString();
        const submittedAtMs = Date.parse(submittedAtIso);
        const resolutionSeconds = Number.isFinite(acceptedAtMs)
            ? Math.max(0, Math.round((submittedAtMs - acceptedAtMs) / 1000))
            : null;

        const base64Proof = await compressImage(file);
        const existingTimer = activeTaskTimers.get(id);
        if (existingTimer) {
            clearInterval(existingTimer);
            activeTaskTimers.delete(id);
        }

        await updateDoc(issueRef, { 
            status: 'under-review',
            proof_url: base64Proof,
            proof_timestamp: submittedAtIso,
            submitted_for_review_at: submittedAtIso,
            resolution_seconds: resolutionSeconds
        });
        
        const quote = buildCompletionQuote(resolutionSeconds);
        setAIStatus(`${quote} Awaiting NGO review.`, false);
        setTimeout(() => aiStatusToast.style.display = 'none', 3000);
    } catch (e) {
        setAIStatus("Sync failed: " + e.message, false);
    }
};

function listenToReviewTasks() {
    const q = query(collection(db, "issues"), where("accepted_volunteer", "==", auth.currentUser.uid), where("status", "==", "under-review"));
    onSnapshot(q, (snap) => {
        reviewTaskList.innerHTML = snap.empty ? '<p style="font-size:0.7rem;text-align:center;">No tasks in review.</p>' : '';
        snap.forEach(d => {
            const card = document.createElement('div');
            card.className = 'card glass';
            card.style.padding = '12px';
            card.style.borderLeft = '4px solid #8b5cf6';
            card.innerHTML = `<h4 style="font-size:0.85rem;">${d.data().title}</h4><p style="font-size:0.65rem;color:#8b5cf6;">UNDER NGO REVIEW</p>`;
            reviewTaskList.appendChild(card);
        });
    });
}

function listenToPastTasks() {
    const q = query(collection(db, "issues"), where("accepted_volunteer", "==", auth.currentUser.uid), where("status", "==", "completed"));
    onSnapshot(q, (snap) => {
        pastTaskList.innerHTML = snap.empty ? '<p style="font-size:0.7rem;text-align:center;">No history.</p>' : '';
        snap.forEach(d => {
            const card = document.createElement('div');
            card.className = 'card glass';
            card.style.padding = '10px';
            card.innerHTML = `<h4 style="font-size:0.85rem;">${d.data().title}</h4><p style="font-size:0.65rem;color:var(--secondary);">COMPLETED</p>`;
            pastTaskList.appendChild(card);
        });
    });
}

function listenToIgnoredTasks() {
    const q = query(collection(db, "assignments"), where("ignored_by", "array-contains", auth.currentUser.uid));
    onSnapshot(q, async (snap) => {
        ignoredTaskList.innerHTML = snap.empty ? '<p style="font-size:0.7rem;text-align:center;">None.</p>' : '';
        snap.forEach(async (d) => {
            const iDoc = await getDoc(doc(db, "issues", d.data().issue_id));
            if (iDoc.exists()) {
                const card = document.createElement('div');
                card.className = 'card glass';
                card.style.padding = '10px';
                card.style.opacity = '0.6';
                card.innerHTML = `<h4 style="font-size:0.85rem;">${iDoc.data().title}</h4><p style="font-size:0.65rem;">IGNORED</p>`;
                ignoredTaskList.appendChild(card);
            }
        });
    });
}

function listenToEligibilityNotifications() {
    const q = query(
        collection(db, "notifications"),
        where("volunteer_id", "==", auth.currentUser.uid),
        where("unread", "==", true)
    );
    onSnapshot(q, async (snap) => {
        const docs = snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

        const volunteerAge = parseEligibilityNumber(currentVolunteer?.age);

        for (const note of docs) {
            if (seenNotificationIds.has(note.id)) continue;

            if (note.issue_id) {
                const issueSnap = await getDoc(doc(db, "issues", note.issue_id));
                if (issueSnap.exists()) {
                    const minAge = getIssueMinAge(issueSnap.data());
                    if (Number.isFinite(minAge) && minAge > 0 && (!Number.isFinite(volunteerAge) || volunteerAge < minAge)) {
                        await updateDoc(doc(db, "notifications", note.id), {
                            unread: false,
                            read_at: new Date().toISOString(),
                            filtered_out: true,
                            filtered_reason: "age_mismatch"
                        });
                        seenNotificationIds.add(note.id);
                        continue;
                    }
                }
            }

            seenNotificationIds.add(note.id);
            const score = Number(note.match_score || 0).toFixed(1);
            setAIStatus(`Matched issue: ${note.issue_title || "Mission"} (fit ${score})`, false);
            setTimeout(() => aiStatusToast.style.display = 'none', 3000);
        }
    });
}

async function markIssueNotificationsRead(issueId) {
    const q = query(
        collection(db, "notifications"),
        where("volunteer_id", "==", auth.currentUser.uid),
        where("issue_id", "==", issueId),
        where("unread", "==", true)
    );
    const snap = await getDocs(q);
    for (const docSnap of snap.docs) {
        await updateDoc(doc(db, "notifications", docSnap.id), {
            unread: false,
            read_at: new Date().toISOString()
        });
    }
}

function setAIStatus(text, spin) {
    aiStatusToast.style.display = 'block';
    aiStatusText.textContent = text;
    document.getElementById('ai-spinner').style.display = spin ? 'block' : 'none';
}

let activeAlertIds = new Set();
let seenAlertIds = new Set();

function listenToGlobalAlerts() {
    const q = query(collection(db, "global_alerts"), where("active", "==", true));
    
    onSnapshot(q, (snap) => {
        const currentActiveIds = snap.docs.map(doc => doc.id);
        
        // 1. Remove circles for alerts that are no longer active in DB
        activeAlertIds.forEach(id => {
            if (!currentActiveIds.includes(id)) {
                const circle = document.getElementById(`sos-circle-${id}`);
                if (circle) circle.remove();
                activeAlertIds.delete(id);
            }
        });

        // 2. Add new active circles (if not already seen)
        snap.docs.forEach(doc => {
            if (activeAlertIds.has(doc.id) || seenAlertIds.has(doc.id)) return;
            activeAlertIds.add(doc.id);

            const alertData = doc.data();
            const sosCircle = document.createElement('div');
            sosCircle.id = `sos-circle-${doc.id}`;
            sosCircle.className = 'pulse';
            sosCircle.style = "position: fixed; right: 20px; top: 100px; width: 65px; height: 65px; background: #ef4444; border-radius: 50%; z-index: 10000; display: flex; align-items: center; justify-content: center; color: white; cursor: pointer; box-shadow: 0 0 30px rgba(239, 68, 68, 0.8); border: 3px solid white;";
            sosCircle.innerHTML = `<i data-lucide="megaphone" style="width: 28px;"></i>`;
            
            sosCircle.onclick = () => {
                const pane = document.createElement('div');
                pane.className = 'glass fade-in';
                pane.style = "position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 350px; padding: 30px; z-index: 10001; border-top: 5px solid #ef4444; text-align: center; box-shadow: var(--shadow-2xl);";
                pane.innerHTML = `
                    <h2 style="color: #ef4444; margin-bottom: 15px;">EMERGENCY SOS</h2>
                    <p style="font-weight: 700; margin-bottom: 10px;">FROM: ${alertData.sender}</p>
                    <p style="font-size: 1.1rem; line-height: 1.5; margin-bottom: 25px;">"${alertData.message}"</p>
                    <button id="close-sos-${doc.id}" class="btn btn-primary" style="width: 100%; background: #ef4444;">I'VE SEEN THIS</button>
                `;
                document.body.appendChild(pane);
                document.getElementById(`close-sos-${doc.id}`).onclick = () => {
                    pane.remove();
                    sosCircle.remove();
                    seenAlertIds.add(doc.id); // Permanently mute for this session
                };
                lucide.createIcons();
            };

            document.body.appendChild(sosCircle);
            lucide.createIcons();
            const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
            audio.play().catch(e => console.log("Audio blocked"));
        });
    });
}

window.showMissionPrep = (category) => {
    const tips = {
        'medical-emergency': ['Carry first-aid kit', 'Wear gloves and mask', 'Coordinate nearest hospital'],
        'road-accident': ['Secure traffic area', 'Call emergency services', 'Provide first response safely'],
        'fire-response': ['Do not enter unsafe zone', 'Coordinate evacuation route', 'Keep fire safety gear ready'],
        'flood-relief': ['Wear waterproof boots', 'Use safe transport routes', 'Carry emergency dry food'],
        'food-distribution': ['Check food quality', 'Prioritize children/elderly', 'Track delivery count'],
        'water-shortage': ['Carry clean containers', 'Verify safe source', 'Coordinate refill points'],
        'elderly-support': ['Carry medicines list', 'Check mobility needs', 'Provide calm communication'],
        'child-support': ['Maintain safe environment', 'Keep hydration ready', 'Coordinate guardian contacts'],
        'missing-person': ['Collect last seen details', 'Coordinate local teams', 'Avoid misinformation'],
        'blood-donation': ['Verify blood group need', 'Coordinate donor queue', 'Keep helpline handy'],
        'rescue-evacuation': ['Wear safety gear', 'Mark safe routes', 'Maintain team communication'],
        'shelter-support': ['Prepare bedding kits', 'Register families', 'Track urgent medical needs']
    };
    const missionTips = tips[category] || ['Stay safe', 'Be helpful', 'Keep NGO updated'];

    const existing = document.getElementById('mission-prep-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'mission-prep-overlay';
    overlay.className = 'fade-in';
    overlay.style = "position: fixed; inset: 0; z-index: 12000; background: rgba(2, 6, 23, 0.9); display: flex; align-items: center; justify-content: center; padding: 20px;";

    const prepModal = document.createElement('div');
    prepModal.className = 'glass';
    prepModal.style = "width: min(920px, 100%); max-height: 90vh; overflow-y: auto; padding: 26px; border-radius: 16px; border: 1px solid rgba(59,130,246,0.45); box-shadow: 0 30px 80px rgba(0,0,0,0.55);";
    prepModal.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:16px; margin-bottom:18px;">
            <div>
                <h2 style="color: var(--primary); font-size: 1.4rem; margin: 0 0 8px 0; letter-spacing: 0.4px;">Mission Help Center</h2>
                <p style="font-size: 0.82rem; color: var(--text-muted); margin: 0;">Review these steps before you begin your field response.</p>
            </div>
            <button id="mission-prep-close-btn" class="btn btn-secondary" style="width: 38px; height: 38px; border-radius: 50%; padding: 0; display:flex; align-items:center; justify-content:center;" title="Close">
                <i data-lucide="x" style="width:18px; height:18px;"></i>
            </button>
        </div>
        <div style="display:grid; gap:10px;">
            ${missionTips.map((t, i) => `
                <div class="glass" style="padding: 12px 14px; border-radius: 10px; border: 1px solid rgba(59,130,246,0.2); background: rgba(59,130,246,0.06);">
                    <p style="margin:0; font-size:0.86rem; color:white; line-height:1.45;"><span style="color: var(--primary); font-weight:800; margin-right:8px;">${i + 1}.</span>${t}</p>
                </div>
            `).join('')}
        </div>
    `;

    overlay.appendChild(prepModal);
    document.body.appendChild(overlay);
    lucide.createIcons();

    const close = () => overlay.remove();
    const closeBtn = document.getElementById('mission-prep-close-btn');
    if (closeBtn) closeBtn.onclick = close;
    overlay.onclick = (e) => {
        if (e.target === overlay) close();
    };
};

window.viewOnMap = (id, lat, lng) => { 
    map.flyTo([lat, lng], 17, { animate: true, duration: 1.5 }); 
};
document.getElementById('logout-btn').onclick = () => signOut(auth);
if (locateMeBtn) {
    locateMeBtn.onclick = () => {
        if (!("geolocation" in navigator)) return;
        navigator.geolocation.getCurrentPosition((pos) => {
            map.flyTo([pos.coords.latitude, pos.coords.longitude], 15);
        });
    };
}


