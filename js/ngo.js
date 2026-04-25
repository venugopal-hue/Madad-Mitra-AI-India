import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import { collection, addDoc, query, onSnapshot, doc, getDoc, getDocs, where, updateDoc } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { auth, db } from "./config.js";
import { getPriorityClass, formatDate } from "./utils.js";
import { matchVolunteers } from "./matching.js";

let map, marker, issuesMarkers = {};
let currentNGO = null;

// UI Elements
const issueForm = document.getElementById('issue-form');
const activeList = document.getElementById('active-list');
const assignedList = document.getElementById('assigned-list');
const reviewList = document.getElementById('review-list');
const completedList = document.getElementById('completed-list');
const cancelledList = document.getElementById('cancelled-list');
const reportReviewList = document.getElementById('report-review-list');
const createModal = document.getElementById('create-modal');
const showCreateBtn = document.getElementById('show-create-modal');
const closeModalBtn = document.getElementById('close-modal');
const aiStatusToast = document.getElementById('ai-status-toast');
const aiStatusText = document.getElementById('ai-status-text');
const locateMeBtn = document.getElementById('locate-me-btn');
const openSosModalBtn = document.getElementById('open-sos-modal-btn');
const sosModal = document.getElementById('sos-modal');
const closeSosModalBtn = document.getElementById('close-sos-modal');
const sosForm = document.getElementById('sos-form');
const sosMessageInput = document.getElementById('sos-message');
const approveReportModal = document.getElementById('approve-report-modal');
const closeApproveReportModalBtn = document.getElementById('close-approve-report-modal');
const approveReportForm = document.getElementById('approve-report-form');
let pendingApproveReportId = null;

// Initialize Dashboard
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists() && userDoc.data().role === 'ngo') {
            currentNGO = { id: user.uid, ...userDoc.data() };
            
            // Auto-Migration Fix: Generate unique code if missing
            if (!currentNGO.unique_code) {
                currentNGO.unique_code = "MM-" + Math.floor(1000 + Math.random() * 9000);
                await updateDoc(doc(db, "users", user.uid), { unique_code: currentNGO.unique_code });
            }

            // Populate Profile UI
            document.getElementById('profile-ngo-name').textContent = currentNGO.name || "Unnamed NGO";
            document.getElementById('profile-ngo-code').textContent = currentNGO.unique_code;
            document.getElementById('profile-ngo-contact').textContent = currentNGO.contact || "No Contact";
            
            // Re-initialize Profile Edit Logic with loaded data
            initProfileEditor();
            
            lucide.createIcons();
            initMap();
            listenToIssues();
            listenToVolunteerReports();
            listenToVolunteers();
            listenToGlobalAlerts();
            autoMatchVolunteers();
            startPulseAnimation();
            
            setInterval(() => {
                autoMatchVolunteers();
                startPulseAnimation();
            }, 10000);
        } else {
            window.location.href = 'index.html';
        }
    } else {
        window.location.href = 'index.html';
    }
});

function initProfileEditor() {
    const profileModal = document.getElementById('profile-modal');
    const editProfileBtn = document.getElementById('edit-profile-btn');
    const closeProfileBtn = document.getElementById('close-profile-modal');
    const profileForm = document.getElementById('profile-form');

    if (editProfileBtn) {
        editProfileBtn.onclick = () => {
            document.getElementById('edit-ngo-name').value = currentNGO.name;
            document.getElementById('edit-ngo-contact').value = currentNGO.contact || "";
            profileModal.style.display = 'flex';
        };
    }

    if (closeProfileBtn) closeProfileBtn.onclick = () => profileModal.style.display = 'none';

    if (profileForm) {
        profileForm.onsubmit = async (e) => {
            e.preventDefault();
            const newName = document.getElementById('edit-ngo-name').value;
            const newContact = document.getElementById('edit-ngo-contact').value;
            
            setAIStatus("Updating cloud profile...", true);
            try {
                await updateDoc(doc(db, "users", auth.currentUser.uid), {
                    name: newName,
                    contact: newContact
                });
                currentNGO.name = newName;
                currentNGO.contact = newContact;
                document.getElementById('profile-ngo-name').textContent = newName;
                document.getElementById('profile-ngo-contact').textContent = newContact;
                profileModal.style.display = 'none';
                setAIStatus("Profile updated successfully!", false);
            } catch (err) {
                setAIStatus("Update failed: " + err.message, false);
            }
            setTimeout(() => aiStatusToast.style.display = 'none', 3000);
        };
    }
}

function startPulseAnimation() {
    const pulseBar = document.getElementById('pulse-bar');
    const pulseTimer = document.getElementById('pulse-timer');
    if (!pulseBar) return;
    
    pulseBar.style.transition = 'none';
    pulseBar.style.width = '0%';
    void pulseBar.offsetWidth;
    pulseBar.style.transition = 'width 10s linear';
    pulseBar.style.width = '100%';
    
    pulseTimer.textContent = "Scanning...";
    setTimeout(() => {
        if (pulseTimer) pulseTimer.textContent = "Syncing...";
    }, 9000);
}

function urgencyRank(tag) {
    const order = { critical: 4, high: 3, medium: 2, low: 1 };
    return order[String(tag || "low").toLowerCase()] || 1;
}

function sortIssuesForDispatch(issues) {
    return [...issues].sort((a, b) => {
        const priorityDiff = urgencyRank(b.urgency_tag) - urgencyRank(a.urgency_tag);
        if (priorityDiff !== 0) return priorityDiff;
        return new Date(a.created_at || 0) - new Date(b.created_at || 0);
    });
}
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

function isVolunteerAgeEligible(issue, volunteer) {
    const minAge = getIssueMinAge(issue);
    if (!Number.isFinite(minAge) || minAge <= 0) return true;
    const age = parseEligibilityNumber(volunteer?.age);
    return Number.isFinite(age) && age >= minAge;
}

async function autoMatchVolunteers() {
    const volunteerQuery = query(collection(db, "users"), where("role", "==", "volunteer"), where("availability", "==", "online"));
    const snapshot = await getDocs(volunteerQuery);
    const onlineVolunteers = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    // Scope matching to this NGO's own missions only.
    const ngoIssuesSnap = await getDocs(query(collection(db, "issues"), where("ngo_id", "==", currentNGO.id)));
    const pendingIssues = ngoIssuesSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((issue) => issue.status === "pending");
    const sortedIssues = sortIssuesForDispatch(pendingIssues);

    for (const issue of sortedIssues) {
        if (!issue?.location) continue;
        const matched = matchVolunteers(issue, onlineVolunteers, 8);
        for (const vol of matched) {
            await matchVolunteerToIssue(vol.id, issue.id, vol.matchScore, issue);
        }
    }
}

async function matchVolunteerToIssue(volId, issueId, matchScore = 0, issue = null) {
    if (!issue) return;

    const volunteerDoc = await getDoc(doc(db, "users", volId));
    if (!volunteerDoc.exists()) return;
    const volunteer = volunteerDoc.data();
    if (!isVolunteerAgeEligible(issue, volunteer)) return;

    const q = query(collection(db, "assignments"), where("issue_id", "==", issueId), where("status", "==", "pending_acceptance"));
    const snap = await getDocs(q);
    
    if (!snap.empty) {
        const assignmentDoc = snap.docs[0];
        const potentials = assignmentDoc.data().potential_volunteers || [];
        const scores = assignmentDoc.data().eligibility_scores || {};
        const notified = assignmentDoc.data().notified_volunteers || [];
        scores[volId] = Math.max(scores[volId] || 0, matchScore);

        const updates = { eligibility_scores: scores };
        if (!potentials.includes(volId)) {
            potentials.push(volId);
            updates.potential_volunteers = potentials;

            if (!notified.includes(volId)) {
                notified.push(volId);
                updates.notified_volunteers = notified;
                await addDoc(collection(db, "notifications"), {
                    volunteer_id: volId,
                    issue_id: issueId,
                    issue_title: issue?.title || "New Issue",
                    issue_category: issue?.category || "general",
                    message: `You are matched for ${issue?.title || "an issue"}.`,
                    match_score: Number(matchScore || 0),
                    unread: true,
                    created_at: new Date().toISOString()
                });
            }
        }
        await updateDoc(doc(db, "assignments", assignmentDoc.id), updates);
    }
}

let isPickingLocation = false;
const pickLocationBtn = document.getElementById('pick-location-btn');
const mapSelectionHint = document.getElementById('map-selection-hint');

function initMap() {
    // Add small delay to ensure DOM is fully rendered on mobile
    setTimeout(() => {
        map = L.map('map').setView([20.5937, 78.9629], 5);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
        
        // Fix map display on mobile resize
        window.addEventListener('resize', () => {
            if (map) map.invalidateSize();
        });
        
        if ("geolocation" in navigator) {
            navigator.geolocation.getCurrentPosition((pos) => {
                map.setView([pos.coords.latitude, pos.coords.longitude], 14);
                updateSelectedLocation(pos.coords.latitude, pos.coords.longitude);
            });
        }

        map.on('click', (e) => {
            if (isPickingLocation) {
                updateSelectedLocation(e.latlng.lat, e.latlng.lng);
                isPickingLocation = false;
                createModal.style.display = 'flex'; // Re-show form
                mapSelectionHint.style.display = 'none';
            } else {
                // Default behavior if someone clicks while form is closed
                updateSelectedLocation(e.latlng.lat, e.latlng.lng);
            }
        });
    }, 100);
}

if (pickLocationBtn) {
    pickLocationBtn.onclick = () => {
        isPickingLocation = true;
        createModal.style.display = 'none'; // Minimize form
        mapSelectionHint.style.display = 'block';
    };
}

function updateSelectedLocation(lat, lng) {
    if (marker) map.removeLayer(marker);
    
    const icon = L.divIcon({
        className: 'custom-icon',
        html: `
            <div style="position: relative; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;">
                <div class="pulse" style="position: absolute; width: 12px; height: 12px; background: var(--primary); border-radius: 50%; opacity: 0.6; bottom: 0;"></div>
                <svg viewBox="0 0 24 24" width="36" height="36" style="filter: drop-shadow(0 2px 6px rgba(0,0,0,0.4));">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" fill="var(--primary)" stroke="white" stroke-width="2"/>
                    <circle cx="12" cy="10" r="3" fill="white"/>
                </svg>
            </div>
        `,
        iconSize: [36, 36], iconAnchor: [18, 36]
    });

    marker = L.marker([lat, lng], { icon }).addTo(map);
    document.getElementById('issue-lat').value = lat.toFixed(6);
    document.getElementById('issue-lng').value = lng.toFixed(6);
}

function listenToIssues() {
    // Show only missions posted by the currently logged-in NGO.
    const q = query(collection(db, "issues"), where("ngo_id", "==", currentNGO.id));
    onSnapshot(q, async (snapshot) => {
        let activeIssues = 0;
        let totalCompleted = 0;
        activeList.innerHTML = '';
        assignedList.innerHTML = '';
        reviewList.innerHTML = '';
        completedList.innerHTML = '';
        cancelledList.innerHTML = '';

        const sortedDocs = [...snapshot.docs].sort((a, b) => new Date(b.data().created_at || 0) - new Date(a.data().created_at || 0));
        for (const doc of sortedDocs) {
            const issue = doc.data();
            const status = String(issue.status || '').toLowerCase();
            if (status === 'completed') {
                totalCompleted++;
            } else if (['pending', 'in-progress', 'under-review', 'active', 'assigned'].includes(status)) {
                activeIssues++;
            }

            await renderIssueCard(doc.id, issue);
            updateMapMarker(doc.id, issue);
        }
        document.getElementById('stat-active-issues').textContent = activeIssues;
        document.getElementById('stat-total-completed').textContent = totalCompleted;
    });
}

function listenToVolunteerReports() {
    if (!reportReviewList) return;
    const q = query(collection(db, "volunteer_reports"), where("status", "==", "pending_review"));
    onSnapshot(q, (snap) => {
        if (snap.empty) {
            reportReviewList.innerHTML = '<p style="font-size:0.68rem; color:var(--text-muted); text-align:center;">No pending reports.</p>';
            return;
        }

        const sorted = [...snap.docs].sort((a, b) => new Date(b.data().created_at || 0) - new Date(a.data().created_at || 0));
        reportReviewList.innerHTML = "";
        sorted.forEach((docSnap) => {
            const report = docSnap.data();
            const card = document.createElement('div');
            card.className = 'card glass fade-in';
            card.style.padding = '10px';
            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                    <span class="badge ${getPriorityClass(report.urgency_tag || 'medium')}">${report.urgency_tag || 'medium'}</span>
                    <span style="font-size:0.65rem; color:var(--text-muted);">${formatDate(report.created_at)}</span>
                </div>
                <h4 style="font-size:0.82rem; margin-bottom:4px;">${report.title || 'Issue Report'}</h4>
                <p style="font-size:0.68rem; color:var(--text-muted); margin-bottom:6px;">${(report.description || '').substring(0, 90)}...</p>
                <p style="font-size:0.65rem; color:var(--primary); margin-bottom:8px;">From: ${report.reporter_name || 'Volunteer'} | Type: ${(report.category || 'general').replaceAll('-', ' ')}</p>
                <div style="display:flex; gap:6px;">
                    <button class="btn btn-primary" style="flex:1; padding:6px; font-size:0.68rem;" onclick="window.openApproveReportModal('${docSnap.id}')">Approve</button>
                    <button class="btn btn-secondary" style="flex:1; padding:6px; font-size:0.68rem; border-color:#ef4444; color:#ef4444;" onclick="window.rejectVolunteerReport('${docSnap.id}')">Reject</button>
                </div>
            `;
            reportReviewList.appendChild(card);
        });
    });
}

window.openApproveReportModal = (reportId) => {
    pendingApproveReportId = reportId;
    if (!approveReportModal) return;
    approveReportModal.style.display = 'flex';
};

if (closeApproveReportModalBtn && approveReportModal) {
    closeApproveReportModalBtn.onclick = () => {
        approveReportModal.style.display = 'none';
        pendingApproveReportId = null;
    };
}

if (approveReportModal) {
    approveReportModal.onclick = (e) => {
        if (e.target === approveReportModal) {
            approveReportModal.style.display = 'none';
            pendingApproveReportId = null;
        }
    };
}

if (approveReportForm) {
    approveReportForm.onsubmit = async (e) => {
        e.preventDefault();
        if (!pendingApproveReportId) return;

        const requiredAgeMin = Math.max(18, Number.parseInt(document.getElementById('approve-min-age').value, 10) || 18);
        const requiredLanguage = (document.getElementById('approve-language').value || "any").toLowerCase();
        const requiredExperienceYears = Number.parseInt(document.getElementById('approve-min-experience').value, 10) || 0;
        const requiredProfession = (document.getElementById('approve-profession').value || "any").toLowerCase();
        const requiredSkills = (document.getElementById('approve-required-skills').value || "")
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);

        const reportId = pendingApproveReportId;
        if (approveReportModal) approveReportModal.style.display = 'none';
        pendingApproveReportId = null;

        await window.approveVolunteerReport(reportId, {
            required_age_min: requiredAgeMin,
            required_language: requiredLanguage,
            required_experience_years: requiredExperienceYears,
            required_profession: requiredProfession,
            required_skills: requiredSkills
        });
    };
}

async function renderIssueCard(id, issue) {
    const card = document.createElement('div');
    card.className = 'card glass fade-in';
    card.style.padding = '12px';
    
    let volDetails = "";
    if (issue.accepted_volunteer) {
        const volDoc = await getDoc(doc(db, "users", issue.accepted_volunteer));
        if (volDoc.exists()) {
            const vol = volDoc.data();
            volDetails = `
                <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid var(--secondary); padding: 8px; border-radius: 5px; margin-top: 10px; font-size: 0.75rem;">
                    <p style="font-weight: 700; color: var(--secondary);">VOLUNTEER: ${vol.name}</p>
                    <p>Phone: ${vol.phone || 'N/A'}</p>
                </div>
            `;
        }
    }

    const imagePreview = issue.image_url ? `
        <div style="margin: 10px 0; border-radius: 8px; overflow: hidden; height: 120px; border: 1px solid var(--border-color);">
            <img src="${issue.image_url}" style="width: 100%; height: 100%; object-fit: cover; cursor: pointer;" onclick="window.open('${issue.image_url}', '_blank')">
        </div>
    ` : "";

    const ocrSnippet = issue.ocr_details ? `
        <p style="font-size: 0.65rem; color: var(--primary); background: rgba(59,130,246,0.05); padding: 5px; border-radius: 4px; margin-bottom: 10px;">
            OCR: ${issue.ocr_details.substring(0, 100)}...
        </p>
    ` : "";

    const eligibilitySnippet = `
        <div style="font-size: 0.65rem; color: var(--text-muted); margin-bottom: 8px; display: grid; grid-template-columns: 1fr 1fr; gap: 4px;">
            <span>Type: <strong style="color: var(--primary);">${String(issue.category || "general").replaceAll("-", " ")}</strong></span>
            <span>Age: <strong style="color: var(--primary);">${issue.required_age_min || 18}+</strong></span>
            <span>Lang: <strong style="color: var(--primary);">${issue.required_language || "any"}</strong></span>
            <span>Exp: <strong style="color: var(--primary);">${issue.required_experience_years || 0}y+</strong></span>
            <span style="grid-column: span 2;">Profession: <strong style="color: var(--primary);">${issue.required_profession || "any"}</strong></span>
            <span style="grid-column: span 2;">Skills: <strong style="color: var(--primary);">${(issue.required_skills || []).join(", ") || "any"}</strong></span>
        </div>
    `;

    const proofPreview = (issue.status === 'under-review' && issue.proof_url) ? `
        <div style="background: rgba(139, 92, 246, 0.1); border: 1px dashed #8b5cf6; padding: 8px; border-radius: 5px; margin-top: 10px;">
            <p style="font-weight: 700; color: #8b5cf6; font-size: 0.75rem; margin-bottom: 5px;">SUBMITTED PROOF</p>
            <img src="${issue.proof_url}" style="width: 100%; height: 100px; object-fit: cover; border-radius: 4px; cursor: pointer;" onclick="window.open('${issue.proof_url}', '_blank')">
        </div>
    ` : "";

    const resolvedInSnippet = Number.isFinite(Number(issue.resolution_seconds)) ? `
        <div style="margin-top: 8px; padding: 6px 8px; border-radius: 6px; background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.35);">
            <p style="font-size: 0.7rem; color: var(--secondary); font-weight: 700; margin: 0;">Resolved in ${Math.max(0, Math.round(Number(issue.resolution_seconds)))} secs</p>
        </div>
    ` : "";

    card.innerHTML = `
        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
            <span class="badge ${getPriorityClass(issue.urgency_tag)}">${issue.urgency_tag}</span>
            <span style="font-size: 0.7rem; color: var(--text-muted);">${formatDate(issue.created_at)}</span>
        </div>
        <h4 style="font-size: 0.9rem; margin-bottom: 5px;">${issue.title}</h4>
        ${imagePreview}
        <p style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 10px;">${issue.description.substring(0, 80)}...</p>
        ${eligibilitySnippet}
        ${ocrSnippet}
        ${proofPreview}
        ${resolvedInSnippet}
        ${volDetails}
        <div style="display: flex; gap: 5px; margin-top: 10px;">
            <select onchange="window.updateIssueStatus('${id}', this.value)" class="btn btn-secondary" style="padding: 4px; font-size: 0.7rem; flex: 1;">
                <option value="pending" ${issue.status === 'pending' ? 'selected' : ''}>Pending</option>
                <option value="in-progress" ${issue.status === 'in-progress' ? 'selected' : ''}>In Progress</option>
                <option value="under-review" ${issue.status === 'under-review' ? 'selected' : ''}>Under Review</option>
                <option value="completed" ${issue.status === 'completed' ? 'selected' : ''}>Completed</option>
                <option value="cancelled" ${issue.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
            </select>
            ${issue.status === 'under-review' ? `<button class="btn btn-primary" onclick="window.updateIssueStatus('${id}', 'completed')" style="background: #8b5cf6; padding: 4px;">Approve</button>` : ''}
            ${(issue.status === 'pending' || issue.status === 'active') ? `<button class="btn btn-secondary" title="Re-Notify Volunteers" onclick="window.reNotifyVolunteers('${id}')" style="padding: 4px; width: 32px; border-color: #f59e0b; color: #f59e0b;"><i data-lucide="megaphone" style="width: 14px;"></i></button>` : ''}
            <button class="btn btn-primary" onclick="window.viewOnMap('${id}', '${issue.location.lat}', '${issue.location.lng}')" style="padding: 4px; width: 30px;"><i data-lucide="map-pin" style="width: 14px;"></i></button>
        </div>
    `;

    if (issue.status === 'pending') activeList.appendChild(card);
    else if (issue.status === 'in-progress') assignedList.appendChild(card);
    else if (issue.status === 'under-review') reviewList.appendChild(card);
    else if (issue.status === 'completed') completedList.appendChild(card);
    else if (issue.status === 'cancelled') cancelledList.appendChild(card);
    lucide.createIcons();
}

function updateMapMarker(id, issue) {
    if (issuesMarkers[id]) map.removeLayer(issuesMarkers[id]);
    let color = '#ef4444';
    if (issue.status === 'in-progress') color = '#f59e0b';
    if (issue.status === 'under-review') color = '#8b5cf6';
    if (issue.status === 'completed') color = '#10b981';
    if (issue.status === 'cancelled') color = '#6b7280';

    const icon = L.divIcon({
        className: 'custom-icon',
        html: `
            <div style="position: relative; width: 24px; height: 24px;">
                <div class="pulse" style="position: absolute; width: 100%; height: 100%; background: ${color}; border-radius: 50%; opacity: 0.4;"></div>
                <div style="position: absolute; top: 4px; left: 4px; width: 16px; height: 16px; background: ${color}; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 10px ${color};"></div>
            </div>
        `,
        iconSize: [24, 24], iconAnchor: [12, 12]
    });

    issuesMarkers[id] = L.marker([issue.location.lat, issue.location.lng], { icon }).addTo(map)
        .bindPopup(`<b>${issue.title}</b><br>Status: ${issue.status.toUpperCase()}`);
}

window.updateIssueStatus = async (id, status) => {
    if (confirm(`Change status to ${status.toUpperCase()}?`)) {
        await updateDoc(doc(db, "issues", id), { status });
        
        // Reward volunteer if officially completed
        if (status === 'completed') {
            const issueSnap = await getDoc(doc(db, "issues", id));
            const volId = issueSnap.data().accepted_volunteer;
            if (volId) {
                const volRef = doc(db, "users", volId);
                const volSnap = await getDoc(volRef);
                const currentTasks = volSnap.data().completed_tasks || 0;
                const currentRating = volSnap.data().rating || 5.0;
                
                await updateDoc(volRef, { 
                    completed_tasks: currentTasks + 1,
                    rating: Math.min(5.0, currentRating + 0.1) // Bonus for completion
                });
            }
        }
    }
};

window.viewOnMap = (id, lat, lng) => {
    map.flyTo([lat, lng], 17);
    if (issuesMarkers[id]) issuesMarkers[id].openPopup();
};

function setAIStatus(text, spin) {
    aiStatusToast.style.display = 'block';
    aiStatusText.textContent = text;
    document.getElementById('ai-spinner').style.display = spin ? 'block' : 'none';
}

// Image & OCR Logic
const issueImageInput = document.getElementById('issue-image');
const ocrPreview = document.getElementById('ocr-preview');
const extractTextBtn = document.getElementById('extract-text-btn');
const ocrResult = document.getElementById('issue-ocr-result');

if (issueImageInput) {
    issueImageInput.onchange = (e) => {
        if (e.target.files[0] && ocrPreview) ocrPreview.style.display = 'block';
    };
}

if (extractTextBtn) {
    extractTextBtn.onclick = async () => {
        const file = issueImageInput ? issueImageInput.files[0] : null;
        if (!file) return;
        
        setAIStatus("AI is reading the photo...", true);
        try {
            const result = await Tesseract.recognize(file, 'eng');
            if (ocrResult) ocrResult.value = result.data.text;
            setAIStatus("Text extracted successfully!", false);
        } catch (error) {
            setAIStatus("Failed to read photo.", false);
        }
        setTimeout(() => aiStatusToast.style.display = 'none', 3000);
    };
}

async function compressImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onerror = () => reject(new Error("Failed to load image."));
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 600; // Smaller for Base64 storage
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
                // Convert to Base64 string directly
                resolve(canvas.toDataURL('image/jpeg', 0.5));
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

issueForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('issue-title').value;
    const description = document.getElementById('issue-desc').value;
    const category = document.getElementById('issue-category').value;
    const requiredAgeMin = Math.max(PLATFORM_MIN_VOLUNTEER_AGE, Number.parseInt(document.getElementById('issue-min-age').value, 10) || PLATFORM_MIN_VOLUNTEER_AGE);
    const requiredLanguage = (document.getElementById('issue-language').value || "any").toLowerCase();
    const requiredExperienceYears = Number.parseInt(document.getElementById('issue-min-experience').value, 10) || 0;
    const requiredProfession = (document.getElementById('issue-profession').value || "any").toLowerCase();
    const requiredSkills = (document.getElementById('issue-required-skills').value || "")
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    const lat = parseFloat(document.getElementById('issue-lat').value);
    const lng = parseFloat(document.getElementById('issue-lng').value);
    const imageFile = issueImageInput ? issueImageInput.files[0] : null;
    const ocrData = ocrResult ? ocrResult.value : "";
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
        setAIStatus("Please set issue location on the map first.", false);
        setTimeout(() => aiStatusToast.style.display = 'none', 3000);
        return;
    }

    setAIStatus("Processing free image storage...", true);
    
    try {
        let base64Image = null;
        if (imageFile) {
            base64Image = await compressImage(imageFile);
            setAIStatus("Photo optimized. Posting issue...", true);
        }

        const urgency = document.getElementById('issue-urgency').value;
        const issueData = {
            title, description, category,
            location: { lat, lng },
            status: 'pending',
            urgency_tag: urgency,
            required_age_min: requiredAgeMin,
            required_language: requiredLanguage,
            required_experience_years: requiredExperienceYears,
            required_profession: requiredProfession,
            required_skills: requiredSkills,
            ngo_id: currentNGO.id,
            ngo_name: currentNGO.name,
            ngo_code: currentNGO.unique_code || "MM-XXXX",
            ngo_contact: currentNGO.contact || "N/A",
            created_at: new Date().toISOString(),
            accepted_volunteer: null,
            image_url: base64Image, // Stored as string
            ocr_details: ocrData
        };

        const docRef = await addDoc(collection(db, "issues"), issueData);
        await addDoc(collection(db, "assignments"), {
            issue_id: docRef.id,
            potential_volunteers: [],
            status: 'pending_acceptance',
            created_at: new Date().toISOString()
        });
        
        createModal.style.display = 'none';
        issueForm.reset();
        if (ocrPreview) ocrPreview.style.display = 'none';
        if (ocrResult) ocrResult.value = '';
        setAIStatus("Issue posted!", false);
        setTimeout(() => aiStatusToast.style.display = 'none', 3000);
    } catch (error) {
        console.error("NGO Submission Error:", error);
        setAIStatus("Error: " + error.message, false);
    }
});

// Broadcast SOS Logic
const activeSOSList = document.getElementById('active-sos-list');

function listenToGlobalAlerts() {
    // Remove orderBy to avoid index requirements
    const q = query(collection(db, "global_alerts"), where("active", "==", true));
    onSnapshot(q, (snap) => {
        activeSOSList.innerHTML = snap.empty ? '<p style="font-size: 0.65rem; color: var(--text-muted); text-align: center;">No active SOS alerts.</p>' : '';
        // Sort manually by date for the UI
        const sortedDocs = snap.docs.sort((a, b) => new Date(b.data().created_at) - new Date(a.data().created_at));
        
        sortedDocs.forEach(docSnap => {
            const alert = docSnap.data();
            const alertCard = document.createElement('div');
            alertCard.className = 'glass';
            alertCard.style = "padding: 8px; border-left: 3px solid #ef4444; background: rgba(239, 68, 68, 0.05);";
            alertCard.innerHTML = `
                <p style="font-size: 0.7rem; font-weight: 700; margin-bottom: 4px;">${alert.message.substring(0, 30)}...</p>
                <button onclick="window.stopSOS('${docSnap.id}')" class="btn btn-secondary" style="width: 100%; padding: 3px; font-size: 0.65rem; border-color: #ef4444; color: #ef4444;">Stop Broadcast</button>
            `;
            activeSOSList.appendChild(alertCard);
        });
    });
}

window.stopSOS = async (alertId) => {
    if (confirm("Stop this city-wide broadcast?")) {
        try {
            await updateDoc(doc(db, "global_alerts", alertId), { active: false });
            setAIStatus("Broadcast Stopped.", false);
        } catch (e) {
            setAIStatus("Error stopping broadcast.", false);
        }
        setTimeout(() => aiStatusToast.style.display = 'none', 2000);
    }
};

if (openSosModalBtn && sosModal) {
    openSosModalBtn.onclick = () => {
        sosModal.style.display = 'flex';
        if (sosMessageInput) sosMessageInput.focus();
    };
}

if (closeSosModalBtn && sosModal) {
    closeSosModalBtn.onclick = () => {
        sosModal.style.display = 'none';
    };
}

if (sosModal) {
    sosModal.onclick = (e) => {
        if (e.target === sosModal) sosModal.style.display = 'none';
    };
}

if (sosForm) {
    sosForm.onsubmit = async (e) => {
        e.preventDefault();
        const message = (sosMessageInput?.value || "").trim();
        if (!message) return;

        setAIStatus("Broadcasting SOS Alert...", true);
        try {
            await addDoc(collection(db, "global_alerts"), {
                message,
                sender: currentNGO.name,
                created_at: new Date().toISOString(),
                type: 'emergency',
                active: true
            });
            setAIStatus("Broadcast Sent!", false);
            sosForm.reset();
            if (sosModal) sosModal.style.display = 'none';
        } catch (e2) {
            setAIStatus("Broadcast Failed: " + e2.message, false);
        }
        setTimeout(() => aiStatusToast.style.display = 'none', 3000);
    };
}

let volunteersMarkers = {};
function listenToVolunteers() {
    onSnapshot(query(collection(db, "users"), where("role", "==", "volunteer")), (snap) => {
        let onlineCount = 0;
        const onlineIds = new Set();
        snap.forEach((docSnap) => {
            const vol = docSnap.data();
            if (vol.availability === 'online') onlineCount++;
            if (vol.location && vol.availability === 'online') {
                onlineIds.add(docSnap.id);
                if (volunteersMarkers[docSnap.id]) volunteersMarkers[docSnap.id].setLatLng([vol.location.lat, vol.location.lng]);
                else volunteersMarkers[docSnap.id] = L.marker([vol.location.lat, vol.location.lng], {
                    icon: L.divIcon({ 
                        html: '<div style="background: #10b981; width: 18px; height: 18px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 5px rgba(0,0,0,0.2);"></div>',
                        iconSize: [18, 18], iconAnchor: [9, 9]
                    })
                }).addTo(map).bindPopup(vol.name || "Volunteer");
            }
        });
        Object.keys(volunteersMarkers).forEach((id) => {
            if (!onlineIds.has(id)) {
                map.removeLayer(volunteersMarkers[id]);
                delete volunteersMarkers[id];
            }
        });
        document.getElementById('stat-active-volunteers').textContent = onlineCount;
    });
}

showCreateBtn.onclick = () => createModal.style.display = 'flex';
closeModalBtn.onclick = () => createModal.style.display = 'none';
document.getElementById('logout-btn').onclick = () => signOut(auth);
if (locateMeBtn) {
    locateMeBtn.onclick = () => {
        if (!("geolocation" in navigator)) return;
        navigator.geolocation.getCurrentPosition((pos) => {
            map.flyTo([pos.coords.latitude, pos.coords.longitude], 15);
        });
    };
}

window.approveVolunteerReport = async (reportId, eligibility = null) => {
    setAIStatus("Approving volunteer report and notifying active volunteers...", true);
    try {
        const reportRef = doc(db, "volunteer_reports", reportId);
        const reportSnap = await getDoc(reportRef);
        if (!reportSnap.exists()) {
            setAIStatus("Report not found.", false);
            setTimeout(() => aiStatusToast.style.display = 'none', 2500);
            return;
        }

        const report = reportSnap.data();
        const selectedAge = Math.max(18, Number.parseInt(eligibility?.required_age_min ?? 18, 10) || 18);
        const selectedLanguage = String(eligibility?.required_language || "any").toLowerCase();
        const selectedExperience = Number.parseInt(eligibility?.required_experience_years ?? 0, 10) || 0;
        const selectedProfession = String(eligibility?.required_profession || "any").toLowerCase();
        const selectedSkills = Array.isArray(eligibility?.required_skills) ? eligibility.required_skills : [];

        const issuePayload = {
            title: report.title || "Reported Issue",
            description: report.description || "Issue reported by volunteer.",
            category: report.category || "general",
            location: report.location || null,
            status: "pending",
            urgency_tag: report.urgency_tag || "medium",
            required_age_min: selectedAge,
            required_language: selectedLanguage,
            required_experience_years: selectedExperience,
            required_profession: selectedProfession,
            required_skills: selectedSkills,
            ngo_id: currentNGO.id,
            ngo_name: currentNGO.name,
            ngo_code: currentNGO.unique_code || "MM-XXXX",
            ngo_contact: currentNGO.contact || "N/A",
            created_at: new Date().toISOString(),
            accepted_volunteer: null,
            image_url: report.image_url || null,
            ocr_details: "",
            source: "volunteer_report",
            source_report_id: reportId
        };

        if (!issuePayload.location?.lat || !issuePayload.location?.lng) {
            setAIStatus("Report has no valid location. Ask volunteer to retry with location enabled.", false);
            setTimeout(() => aiStatusToast.style.display = 'none', 3000);
            return;
        }

        const issueRef = await addDoc(collection(db, "issues"), issuePayload);
        await addDoc(collection(db, "assignments"), {
            issue_id: issueRef.id,
            potential_volunteers: [],
            status: 'pending_acceptance',
            created_at: new Date().toISOString()
        });

        await updateDoc(reportRef, {
            status: "approved",
            reviewed_by: currentNGO.id,
            reviewed_at: new Date().toISOString(),
            linked_issue_id: issueRef.id
        });

        const volunteersSnap = await getDocs(query(collection(db, "users"), where("role", "==", "volunteer"), where("availability", "==", "online")));
        const onlineVolunteers = volunteersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const matched = matchVolunteers(issuePayload, onlineVolunteers, 8);
        for (const vol of matched) {
            await matchVolunteerToIssue(vol.id, issueRef.id, vol.matchScore, issuePayload);
        }

        setAIStatus(`Report approved. Alerted ${matched.length} active volunteers.`, false);
    } catch (err) {
        setAIStatus("Approval failed: " + err.message, false);
    }
    setTimeout(() => aiStatusToast.style.display = 'none', 3000);
};

window.rejectVolunteerReport = async (reportId) => {
    setAIStatus("Rejecting volunteer report...", true);
    try {
        await updateDoc(doc(db, "volunteer_reports", reportId), {
            status: "rejected",
            reviewed_by: currentNGO.id,
            reviewed_at: new Date().toISOString()
        });
        setAIStatus("Report rejected.", false);
    } catch (err) {
        setAIStatus("Rejection failed: " + err.message, false);
    }
    setTimeout(() => aiStatusToast.style.display = 'none', 2500);
};

window.reNotifyVolunteers = async (id) => {
    setAIStatus("Re-scanning for nearby volunteers...", true);
    try {
        const [issueSnap, volunteersSnap] = await Promise.all([
            getDoc(doc(db, "issues", id)),
            getDocs(query(collection(db, "users"), where("role", "==", "volunteer"), where("availability", "==", "online")))
        ]);
        if (!issueSnap.exists()) {
            setAIStatus("Issue not found.", false);
            setTimeout(() => aiStatusToast.style.display = 'none', 2500);
            return;
        }

        const issue = issueSnap.data();
        if (issue.ngo_id !== currentNGO.id) {
            setAIStatus("You can re-notify only for your own issues.", false);
            setTimeout(() => aiStatusToast.style.display = 'none', 2500);
            return;
        }
        const onlineVolunteers = volunteersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const matched = matchVolunteers(issue, onlineVolunteers, 8);
        for (const vol of matched) {
            await matchVolunteerToIssue(vol.id, id, vol.matchScore, issue);
        }

        setAIStatus(`Alerted ${matched.length} matched volunteers!`, false);
    } catch (e) {
        setAIStatus("Scan failed.", false);
    }
    setTimeout(() => aiStatusToast.style.display = 'none', 3000);
};

