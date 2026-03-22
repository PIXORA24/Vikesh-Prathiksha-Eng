const config = window.SITE_CONFIG || {};
const events = Object.fromEntries(
  (config.events || []).map((event) => [event.key, event])
);
const defaultStudioPartner = config.studio || {};

const params = new URLSearchParams(window.location.search);
const eventKey = params.get("event");
const data = events[eventKey];
const sessionUnlockKey = `inviteUnlocked:${eventKey}`;
const navigationEntry = performance.getEntriesByType("navigation")[0];
const isReloadNavigation = navigationEntry?.type === "reload";
const userAgent = navigator.userAgent || "";
const platform = navigator.platform || "";
const isIOSDevice =
  /iPad|iPhone|iPod/.test(userAgent) ||
  (platform === "MacIntel" && navigator.maxTouchPoints > 1);

if (!data) {
  window.location.replace("index.html");
  throw new Error("Invalid event key.");
}

document.title = data.pageTitle || config.site?.pageTitle || document.title;

function readParam(name) {
  const value = params.get(name);
  return value ? value.trim() : "";
}

function isSafeUrl(url) {
  return /^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i.test(url);
}

function buildStudioPartner(basePartner) {
  const overrides = {
    name: readParam("studio"),
    label: readParam("studioLabel"),
    url: readParam("studioUrl")
  };

  const partner = {
    enabled: true,
    name: "",
    label: "",
    url: "",
    ...basePartner
  };

  Object.entries(overrides).forEach(([key, value]) => {
    if (value) {
      partner[key] = value;
    }
  });

  if (!isSafeUrl(partner.url)) {
    partner.url = basePartner.url;
  }

  partner.name = partner.name.replace(/^@+/, "").trim();

  return partner;
}

const studioPartner = buildStudioPartner(defaultStudioPartner);
const hasStudioPartner =
  studioPartner.enabled &&
  Boolean(studioPartner.name) &&
  Boolean(studioPartner.url);
const eventDate =
  data.startDate && !Number.isNaN(new Date(data.startDate).getTime())
    ? new Date(data.startDate)
    : null;
const hasCoordinates = Boolean(data.location?.lat && data.location?.lng);
const directionsQuery = data.mapQuery || data.venue || "";
const hasDirections =
  data.directionsEnabled !== false && (hasCoordinates || Boolean(directionsQuery));
const hasCalendar =
  data.calendarEnabled !== false &&
  Boolean(eventDate) &&
  Boolean(data.calendarTitle || data.title);
const hasCountdown =
  data.countdownEnabled !== false &&
  Boolean(eventDate);

const navDim = document.getElementById("navDim");
const video = document.getElementById("video");
const audio = document.getElementById("audio");
const overlay = document.getElementById("overlay");
const openBtn = document.getElementById("openBtn");
const mapBtn = document.getElementById("mapBtn");
const calendarBtn = document.getElementById("calendarBtn");
const actionBar = document.querySelector(".action-bar");
const studioLink = document.getElementById("studioLink");
const studioLinkLabel = document.getElementById("studioLinkLabel");
const studioLinkName = document.getElementById("studioLinkName");

openBtn.textContent = `Tap to Open ${data.title} Invite`;

video.src = data.media?.video || "";
video.poster = data.media?.poster || "";
video.muted = true;
video.playsInline = true;
video.loop = true;

video.addEventListener("ended", () => {
  video.currentTime = 0;
  video.play().catch(() => {});
});

audio.src = data.media?.audio || "";
audio.volume = 1;
audio.loop = true;

let inviteUnlocked = false;
let inviteStarted = false;

try {
  if (isReloadNavigation) {
    sessionStorage.removeItem(sessionUnlockKey);
  }

  inviteUnlocked = sessionStorage.getItem(sessionUnlockKey) === "1";
} catch {}

function markInviteUnlocked() {
  inviteUnlocked = true;

  try {
    sessionStorage.setItem(sessionUnlockKey, "1");
  } catch {}
}

function shouldRequireTapToOpen() {
  if (inviteUnlocked) {
    return false;
  }

  return Boolean(isIOSDevice || isReloadNavigation);
}

function canResumeInvite() {
  return inviteUnlocked || inviteStarted;
}

function syncOverlayState() {
  overlay.style.display =
    needsManualAudioUnlock || (shouldRequireTapToOpen() && !inviteStarted)
      ? "flex"
      : "none";
}

if (hasStudioPartner) {
  studioLink.hidden = false;
  studioLink.href = studioPartner.url;
  studioLinkLabel.textContent = studioPartner.label;
  studioLinkLabel.hidden = !studioPartner.label;
  studioLinkName.textContent = studioPartner.name;
}

if (hasDirections) {
  const destination = hasCoordinates
    ? `${data.location.lat},${data.location.lng}`
    : directionsQuery;

  mapBtn.href =
    "https://www.google.com/maps/dir/?api=1&destination=" +
    encodeURIComponent(destination);
} else {
  mapBtn.hidden = true;
}

if (!hasCalendar) {
  calendarBtn.hidden = true;
}

if (!hasDirections && !hasCalendar) {
  actionBar.hidden = true;
}

let soundOn = true;
let fadeInterval = null;
let navigatingAway = false;
let audioSafetyTimer = null;
let needsManualAudioUnlock = false;

function showTapToOpenFallback() {
  if (isIOSDevice) {
    return;
  }

  needsManualAudioUnlock = true;
  syncOverlayState();
}

function hideTapToOpenFallback() {
  needsManualAudioUnlock = false;
  syncOverlayState();
}

function clearAudioSafetyTimer() {
  clearTimeout(audioSafetyTimer);
  audioSafetyTimer = null;
}

function scheduleAudioSafetyCheck() {
  clearAudioSafetyTimer();

  if (isIOSDevice || navigatingAway || !inviteStarted) {
    return;
  }

  audioSafetyTimer = setTimeout(() => {
    if (!document.hidden && soundOn && !navigatingAway && audio.paused) {
      showTapToOpenFallback();
    }
  }, 1200);
}

function stopFade() {
  clearInterval(fadeInterval);
}

function fadeOutAudio() {
  stopFade();

  fadeInterval = setInterval(() => {
    if (audio.volume > 0.05) {
      audio.volume -= 0.05;
    } else {
      audio.volume = 0;
      audio.pause();
      stopFade();
    }
  }, 40);
}

function fadeInAudio(fromGesture = false) {
  if (!soundOn || navigatingAway) {
    return;
  }

  stopFade();
  audio.volume = 0;

  const playPromise = audio.paused ? audio.play() : Promise.resolve();

  playPromise
    .then(() => {
      hideTapToOpenFallback();
      scheduleAudioSafetyCheck();
      fadeInterval = setInterval(() => {
        if (audio.volume < 0.95) {
          audio.volume += 0.05;
        } else {
          audio.volume = 1;
          stopFade();
        }
      }, 40);
    })
    .catch(() => {
      clearAudioSafetyTimer();
      if (!fromGesture) {
        showTapToOpenFallback();
      }
    });
}

function navigateWithFade(url) {
  navigatingAway = true;
  navDim.classList.add("active");
  markInviteUnlocked();

  if (soundOn) {
    fadeOutAudio();
  }

  setTimeout(() => {
    window.location.href = url;
  }, 150);
}

mapBtn.addEventListener("click", (e) => {
  if (!hasDirections || !mapBtn.href) {
    e.preventDefault();
    return;
  }

  e.preventDefault();
  navigateWithFade(mapBtn.href);
});

calendarBtn.addEventListener("click", (e) => {
  if (!hasCalendar || !eventDate) {
    e.preventDefault();
    return;
  }

  e.preventDefault();

  const start = eventDate;
  const durationHours = Number(data.calendarDurationHours) || 2;
  const end = new Date(start.getTime() + durationHours * 60 * 60 * 1000);

  const formatGoogleDate = (date) =>
    date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

  const googleUrl =
    "https://calendar.google.com/calendar/render?action=TEMPLATE" +
    "&text=" + encodeURIComponent(data.calendarTitle) +
    "&dates=" + formatGoogleDate(start) + "/" + formatGoogleDate(end) +
    "&details=" + encodeURIComponent(data.title + " at " + data.venue) +
    "&location=" + encodeURIComponent(data.venue);

  navigateWithFade(googleUrl);
});

studioLink.addEventListener("click", (e) => {
  const studioUrl = studioLink.getAttribute("href");

  if (!studioUrl) {
    return;
  }

  e.preventDefault();
  navigateWithFade(studioUrl);
});

const countdown = document.createElement("div");
countdown.className = "countdown-ambient";

if (hasCountdown) {
  actionBar.after(countdown);
}

if (hasStudioPartner) {
  (hasCountdown ? countdown : actionBar).after(studioLink);
}

audio.addEventListener("playing", () => {
  hideTapToOpenFallback();
  clearAudioSafetyTimer();
});

audio.addEventListener("pause", () => {
  if (!document.hidden && inviteStarted && soundOn && !navigatingAway && !isIOSDevice) {
    showTapToOpenFallback();
  }
});

const eventTime = hasCountdown ? eventDate.getTime() : null;

function updateCountdown() {
  if (!hasCountdown || eventTime === null) {
    return;
  }

  const now = Date.now();
  const diff = eventTime - now;

  if (diff <= 0) {
    countdown.style.display = "none";
    clearInterval(timer);
    return;
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const minutes = Math.floor((diff / (1000 * 60)) % 60);
  const seconds = Math.floor((diff / 1000) % 60);

  countdown.innerHTML = `
    <div><span>${days}</span><small>Days</small></div>
    <div><span>${String(hours).padStart(2, "0")}</span><small>Hours</small></div>
    <div><span>${String(minutes).padStart(2, "0")}</span><small>Minutes</small></div>
    <div><span>${String(seconds).padStart(2, "0")}</span><small>Seconds</small></div>
  `;
}

let timer = null;

if (hasCountdown) {
  timer = setInterval(updateCountdown, 1000);
  updateCountdown();
}

function startInvite(fromGesture = false) {
  if (fromGesture) {
    markInviteUnlocked();
    hideTapToOpenFallback();
  }

  inviteStarted = true;
  syncOverlayState();
  video.muted = true;
  video.play().catch(() => {});
  fadeInAudio(fromGesture);
}

openBtn.addEventListener("click", () => startInvite(true));

if (shouldRequireTapToOpen()) {
  syncOverlayState();
} else {
  startInvite();
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    audio.pause();
    return;
  }

  if (!canResumeInvite()) {
    syncOverlayState();
    return;
  }

  syncOverlayState();
  video.play().catch(() => {});

  if (soundOn && !navigatingAway) {
    fadeInAudio();
  }
});

window.addEventListener("pageshow", (event) => {
  navigatingAway = false;
  navDim.classList.remove("active");

  if (!canResumeInvite()) {
    syncOverlayState();
    return;
  }

  syncOverlayState();

  if (event.persisted && soundOn) {
    fadeInAudio();
  }

  video.play().catch(() => {});
});

window.addEventListener("focus", () => {
  if (navigatingAway) {
    navigatingAway = false;
    navDim.classList.remove("active");

    if (!canResumeInvite()) {
      syncOverlayState();
      return;
    }

    syncOverlayState();
    video.play().catch(() => {});

    if (soundOn) {
      fadeInAudio();
    }
  }
});
