// Google Sheets dual-submit. CORS note: text/plain avoids an Apps Script preflight.
const GOOGLE_SHEETS_URL =
  "https://script.google.com/macros/s/AKfycbyM1uZ8xfFDlwjfyWbfFH91MqgyFn1LrBOW5w6q9K2D5oA5QHoBG8u1PhhchyKmIaWudg/exec";

const signupForm = document.getElementById("signup");
let phoneInput;
let validationState = {
  name: false,
  email: false,
};

function getFormControls() {
  if (!signupForm) return {};
  return {
    submitButton: signupForm.querySelector('button[type="submit"]'),
    buttonText: signupForm.querySelector(".button-text"),
    buttonLoading: signupForm.querySelector(".button-loading"),
    nameInput: signupForm.querySelector('input[name="name"]'),
    emailInput: signupForm.querySelector('input[name="email"]'),
    phoneElement: signupForm.querySelector('input[name="phone"]'),
  };
}

function getPhoneOptions() {
  return {
    preferredCountries: ["np", "in", "us", "gb"],
    separateDialCode: true,
    utilsScript: "https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/17.0.8/js/utils.js",
    autoPlaceholder: "polite",
    formatOnDisplay: true,
    allowDropdown: true,
    initialCountry: "np",
  };
}

function initializePhoneInput() {
  const { phoneElement } = getFormControls();
  if (!phoneElement) return;

  phoneElement.setAttribute("inputmode", "tel");
  phoneElement.removeAttribute("pattern");

  if (typeof intlTelInput === "undefined") {
    phoneElement.setAttribute("placeholder", "+977 98XXXXXXXX");
    return;
  }

  if (phoneInput && typeof phoneInput.destroy === "function") {
    phoneInput.destroy();
  }

  phoneInput = intlTelInput(phoneElement, getPhoneOptions());
}

function validateForm() {
  const { submitButton, nameInput, emailInput } = getFormControls();
  const name = nameInput ? nameInput.value.trim() : "";
  const email = emailInput ? emailInput.value.trim() : "";

  validationState = {
    name: name.length > 0,
    email: email.length > 0 && email.includes("@"),
  };

  const isFormValid = validationState.name && validationState.email;

  if (submitButton) {
    submitButton.disabled = !isFormValid;
    submitButton.classList.toggle("enabled", isFormValid);
    submitButton.classList.toggle("disabled", !isFormValid);
  }

  return isFormValid;
}

function attachFieldListeners() {
  const { nameInput, emailInput, phoneElement } = getFormControls();
  [nameInput, emailInput, phoneElement].forEach((input) => {
    if (!input) return;
    input.addEventListener("input", validateForm);
    input.addEventListener("blur", validateForm);
  });
}

function getValidationErrors() {
  const errors = [];
  if (!validationState.name) errors.push("Name is required");
  if (!validationState.email) errors.push("Valid email is required");
  return errors;
}

function getPhoneValueForSubmission() {
  const { phoneElement } = getFormControls();
  const rawPhone = phoneElement ? phoneElement.value.trim() : "";
  if (!rawPhone) return "";
  if (!phoneInput) return rawPhone;

  const countryData = phoneInput.getSelectedCountryData();
  const dialCode = countryData && countryData.dialCode
    ? `+${countryData.dialCode}`
    : "";

  return dialCode ? `${dialCode} ${rawPhone}` : rawPhone;
}

function showValidationTooltip() {
  const { submitButton } = getFormControls();
  if (!submitButton || submitButton.querySelector(".validation-tooltip"))
    return;

  const errors = getValidationErrors();
  if (!errors.length) return;

  const tooltip = document.createElement("div");
  tooltip.className = "validation-tooltip";
  tooltip.innerHTML = errors.join("<br>");
  tooltip.addEventListener("mouseenter", () =>
    clearTimeout(tooltip.hideTimeout),
  );
  tooltip.addEventListener("mouseleave", hideValidationTooltip);
  submitButton.appendChild(tooltip);
}

function hideValidationTooltip() {
  const { submitButton } = getFormControls();
  const tooltip = submitButton
    ? submitButton.querySelector(".validation-tooltip")
    : null;
  if (!tooltip) return;

  tooltip.hideTimeout = setTimeout(() => {
    tooltip.classList.add("fade-out");
    setTimeout(() => tooltip.remove(), 180);
  }, 100);
}

function attachButtonTooltip() {
  const { submitButton } = getFormControls();
  if (!submitButton) return;
  submitButton.addEventListener("mouseenter", () => {
    if (submitButton.disabled) showValidationTooltip();
  });
  submitButton.addEventListener("mouseleave", hideValidationTooltip);
}

function submitToGoogleSheets(payload) {
  if (!GOOGLE_SHEETS_URL || GOOGLE_SHEETS_URL.startsWith("PASTE_")) {
    return Promise.reject(new Error("Sheets URL not configured"));
  }

  return fetch(GOOGLE_SHEETS_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
    redirect: "follow",
  });
}

function setLoadingState(isLoading) {
  const { submitButton, buttonText, buttonLoading } = getFormControls();
  if (!submitButton || !buttonText || !buttonLoading) return;

  submitButton.disabled = isLoading;
  buttonText.hidden = isLoading;
  buttonLoading.hidden = !isLoading;
}

async function handleFormSubmission(e) {
  e.preventDefault();

  if (!validateForm()) return;

  setLoadingState(true);

  try {
    const formData = new FormData(signupForm);
    const submittedPhone = getPhoneValueForSubmission();
    formData.set("phone", submittedPhone);

    if (formData.get("_gotcha")) {
      showSuccessMessage();
      return;
    }

    const payload = {
      timestamp: new Date().toISOString(),
      name: (formData.get("name") || "").toString().trim(),
      email: (formData.get("email") || "").toString().trim(),
      phone: submittedPhone,
      pageUrl: window.location.href,
      referrer: document.referrer || "",
    };

    const [formspreeResult, sheetsResult] = await Promise.allSettled([
      fetch("https://formspree.io/f/xojbjrab", {
        method: "POST",
        body: formData,
        headers: { Accept: "application/json" },
      }),
      submitToGoogleSheets(payload),
    ]);

    console.log("Formspree:", formspreeResult, "Sheets:", sheetsResult);

    const formspreeOk =
      formspreeResult.status === "fulfilled" && formspreeResult.value.ok;
    const sheetsOk = sheetsResult.status === "fulfilled";

    if (formspreeOk || sheetsOk) {
      showSuccessMessage();
    } else {
      let message = "Something went wrong. Please try again.";
      if (formspreeResult.status === "fulfilled") {
        try {
          const error = await formspreeResult.value.json();
          if (error && error.error) message = error.error;
        } catch (_) {}
      }
      showErrorMessage(message);
    }
  } catch (error) {
    console.error("Form submission error:", error);
    showErrorMessage(
      "Network error. Please check your connection and try again.",
    );
  } finally {
    setLoadingState(false);
  }
}

function renderFormFields() {
  return `
    <div class="form-brand" aria-hidden="true">
      <img src="imgs/logo.png" alt="">
    </div>
    <div class="form-intro">
      <p class="form-kicker">Founding waitlist</p>
      <h2 id="signup-title">Begin your Kora journey</h2>
      <p class="social-proof" aria-live="polite">Join over <strong>200</strong> early members waiting for Kora.</p>
    </div>

    <div class="field">
      <label for="name">Full name <span class="required-marker" aria-hidden="true">*</span></label>
      <input id="name" name="name" type="text" placeholder="e.g. Jordan Rivera" autocomplete="name" required>
    </div>

    <div class="field">
      <label for="email">Email <span class="required-marker" aria-hidden="true">*</span></label>
      <input id="email" name="email" type="email" placeholder="name@email.com" autocomplete="email" required>
    </div>

    <div class="field">
      <label for="phone">Phone number</label>
      <div class="phone-input-container">
        <input type="tel" id="phone" name="phone" placeholder="Enter phone number" autocomplete="tel">
      </div>
    </div>


    <button type="submit" class="submit-button" aria-label="Join the waitlist">
      <span class="button-text">Join the Waitlist</span>
      <span class="button-loading" hidden>
        <svg class="spinner" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M21 12a9 9 0 11-6.219-8.56"/>
        </svg>
        Submitting...
      </span>
    </button>
    <p class="form-microcopy" id="form-microcopy">No spam. Opening dates and events only.</p>

    <input type="text" name="_gotcha" class="honeypot" tabindex="-1" autocomplete="off">
    <input type="hidden" name="_subject" value="New Kora Waitlist Signup">
    <input type="hidden" name="_next" value="">
    <input type="hidden" name="_captcha" value="false">
  `;
}

function showSuccessMessage() {
  if (!signupForm) return;
  signupForm.innerHTML = `
    <div class="success-message" role="status" aria-live="polite">
      <div class="message-panel">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
          <polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
        <h2 class="message-title">You're on the list.</h2>
        <p class="message-copy">We'll be in touch soon.</p>
        <button type="button" class="message-action" onclick="resetForm()">Add Another</button>
      </div>
    </div>
  `;
}

function showErrorMessage(message) {
  if (!signupForm) return;
  signupForm.innerHTML = `
    <div class="error-message" role="alert" aria-live="assertive">
      <div class="message-panel">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M10 14L21 3"/>
          <path d="M21 12L10 23"/>
        </svg>
        <h2 class="message-title">Please try again.</h2>
        <p class="message-copy">${message}</p>
        <button type="button" class="message-action" onclick="resetForm()">Try Again</button>
      </div>
    </div>
  `;
}

function resetForm() {
  if (!signupForm) return;
  signupForm.innerHTML = renderFormFields();
  initializeForm();
}

function initAnimations() {
  if (
    typeof gsap === "undefined" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    if (signupForm) {
      signupForm.style.opacity = 1;
      signupForm.style.transform = "none";
    }
    return;
  }

  const panel = document.getElementById("panel");
  const signup = document.getElementById("signup");
  const eyebrow = document.querySelector(".eyebrow");
  const gymDescription = document.querySelector(".gym-description");
  const headlineLines = document.querySelectorAll(".headline span");
  const timeline = gsap.timeline({ defaults: { ease: "power3.out" } });

  if (panel) {
    timeline.from(panel, {
      opacity: 0,
      y: 24,
      filter: "blur(8px)",
      duration: 0.75,
    });
  }

  if (eyebrow) {
    timeline.from(
      eyebrow,
      {
        opacity: 0,
        y: 14,
        duration: 0.45,
      },
      "-=0.35",
    );
  }

  if (headlineLines.length) {
    timeline.from(
      headlineLines,
      {
        yPercent: 18,
        opacity: 0,
        filter: "blur(5px)",
        duration: 0.7,
        stagger: 0.08,
      },
      "-=0.18",
    );
  }

  if (gymDescription) {
    timeline.from(
      gymDescription,
      {
        y: 18,
        opacity: 0,
        filter: "blur(4px)",
        duration: 0.55,
      },
      "-=0.34",
    );
  }

  if (signup) {
    timeline.to(
      signup,
      {
        y: 0,
        scale: 1,
        opacity: 1,
        duration: 0.62,
      },
      "-=0.44",
    );
  }
}

function initParallax() {
  const hero = document.querySelector(".hero");
  if (!hero || window.matchMedia("(prefers-reduced-motion: reduce)").matches)
    return;

  window.addEventListener(
    "scroll",
    () => {
      hero.style.backgroundPosition = `center calc(50% + ${window.scrollY * 0.06}px)`;
    },
    { passive: true },
  );
}

function initializeForm() {
  initializePhoneInput();
  attachFieldListeners();
  attachButtonTooltip();
  validateForm();
}

if (signupForm) {
  signupForm.addEventListener("submit", handleFormSubmission);
  initializeForm();
}

// === Kora Spaces carousel ===
function initSpacesSwiper() {
  const swiper = document.querySelector("[data-spaces-swiper]");
  if (!swiper) return;

  const slides = Array.from(swiper.querySelectorAll(".spaces-slide"));
  const dotsWrap = swiper.querySelector(".spaces-dots");
  const prevButton = swiper.querySelector("[data-spaces-prev]");
  const nextButton = swiper.querySelector("[data-spaces-next]");
  const track = swiper.querySelector(".spaces-track");
  const section = swiper.closest(".spaces-section");
  if (!slides.length || !dotsWrap || !prevButton || !nextButton) return;

  let activeIndex = 0;
  let dragStartX = 0;
  let isDragging = false;
  let didDrag = false;
  let autoplayTimer;

  function syncTrackHeight() {
    if (!track) return;
    swiper.style.setProperty(
      "--spaces-track-height",
      `${track.getBoundingClientRect().height}px`,
    );
  }

  const getOffset = (index) => {
    const rawOffset = index - activeIndex;
    if (rawOffset > slides.length / 2) return rawOffset - slides.length;
    if (rawOffset < -slides.length / 2) return rawOffset + slides.length;
    return rawOffset;
  };

  const dots = slides.map((slide, index) => {
    const dot = document.createElement("button");
    const image = slide.querySelector("img");
    const thumb = document.createElement("img");
    const label = slide.dataset.spaceLabel || `Space ${index + 1}`;

    thumb.src = image?.dataset.src || image?.getAttribute("src") || "";
    thumb.alt = "";
    thumb.loading = "lazy";
    thumb.decoding = "async";

    dot.type = "button";
    dot.className = "spaces-dot";
    dot.dataset.label = label;
    dot.title = label;
    dot.setAttribute("role", "tab");
    dot.setAttribute("aria-label", `Show ${label}`);
    dot.addEventListener("click", (event) => {
      event.stopPropagation();
      activeIndex = index;
      updateSlides();
      resetAutoplay();
    });
    dot.appendChild(thumb);
    dotsWrap.appendChild(dot);
    return dot;
  });

  function loadSlideImage(slide) {
    const image = slide.querySelector("img[data-src]");
    if (!image || image.src === image.dataset.src) return;

    image.src = image.dataset.src;
  }

  function updateSlides() {
    syncTrackHeight();

    slides.forEach((slide, index) => {
      const offset = getOffset(index);
      slide.className = "spaces-slide";
      slide.setAttribute("aria-hidden", offset === 0 ? "false" : "true");
      slide.tabIndex = offset === 0 ? 0 : -1;

      if (Math.abs(offset) <= 2) {
        loadSlideImage(slide);
      }

      if (offset === 0) slide.classList.add("is-active");
      if (offset === -1) slide.classList.add("is-prev");
      if (offset === 1) slide.classList.add("is-next");
      if (offset === -2) slide.classList.add("is-far-prev");
      if (offset === 2) slide.classList.add("is-far-next");
    });

    const activeImage = slides[activeIndex].querySelector("img");
    const activeImageSrc =
      activeImage?.dataset.src || activeImage?.getAttribute("src") || "";
    if (section && activeImageSrc) {
      section.style.setProperty(
        "--spaces-bg-image",
        `url("${activeImageSrc.replace(/"/g, '\\"')}")`,
      );
    }

    dots.forEach((dot, index) => {
      const isActive = index === activeIndex;
      dot.classList.toggle("is-active", isActive);
      dot.setAttribute("aria-selected", isActive ? "true" : "false");
    });

    const activeDot = dots[activeIndex];
    if (activeDot && dotsWrap) {
      const dotLeft = activeDot.offsetLeft;
      const centeredOffset =
        dotLeft - dotsWrap.clientWidth / 2 + activeDot.offsetWidth / 2;
      const maxScroll = dotsWrap.scrollWidth - dotsWrap.clientWidth;

      dotsWrap.scrollTo({
        left: Math.max(0, Math.min(centeredOffset, maxScroll)),
        behavior: "smooth",
      });
    }
  }

  function goToNext() {
    activeIndex = (activeIndex + 1) % slides.length;
    updateSlides();
  }

  function goToPrev() {
    activeIndex = (activeIndex - 1 + slides.length) % slides.length;
    updateSlides();
  }

  function resetAutoplay() {
    window.clearInterval(autoplayTimer);
  }

  prevButton.addEventListener("click", (event) => {
    event.stopPropagation();
    goToPrev();
    resetAutoplay();
  });
  nextButton.addEventListener("click", (event) => {
    event.stopPropagation();
    goToNext();
    resetAutoplay();
  });

  slides.forEach((slide, index) => {
    slide.addEventListener("click", () => {
      if (didDrag || index === activeIndex) return;
      activeIndex = index;
      updateSlides();
      resetAutoplay();
    });
  });

  swiper.tabIndex = 0;
  swiper.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") {
      goToPrev();
      resetAutoplay();
    }
    if (event.key === "ArrowRight") {
      goToNext();
      resetAutoplay();
    }
  });

  swiper.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".spaces-controls")) return;
    if (event.button !== 0 && event.pointerType === "mouse") return;
    dragStartX = event.clientX;
    isDragging = true;
    didDrag = false;
    if (swiper.setPointerCapture) swiper.setPointerCapture(event.pointerId);
    if (track) track.classList.add("is-dragging");
  });

  swiper.addEventListener(
    "pointermove",
    (event) => {
      const rect = swiper.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const edgeSize = Math.min(190, rect.width * 0.22);

      if (!isDragging && event.pointerType === "mouse") {
        swiper.classList.toggle("is-hover-left", pointerX < edgeSize);
        swiper.classList.toggle("is-hover-right", pointerX > rect.width - edgeSize);
      }

      if (isDragging && Math.abs(event.clientX - dragStartX) > 8) didDrag = true;
    },
    { passive: true },
  );

  swiper.addEventListener("pointerleave", () => {
    swiper.classList.remove("is-hover-left", "is-hover-right");
  });

  function finishDrag(event) {
    if (!isDragging) return;
    const distance =
      typeof event.clientX === "number" ? event.clientX - dragStartX : 0;
    isDragging = false;
    if (
      swiper.releasePointerCapture &&
      swiper.hasPointerCapture(event.pointerId)
    ) {
      swiper.releasePointerCapture(event.pointerId);
    }
    if (track) track.classList.remove("is-dragging");

    if (didDrag && Math.abs(distance) >= 42) {
      if (distance > 0) goToPrev();
      if (distance < 0) goToNext();
      resetAutoplay();
    }

    window.setTimeout(() => {
      didDrag = false;
    }, 0);
  }

  swiper.addEventListener("pointerup", finishDrag);
  swiper.addEventListener("pointercancel", finishDrag);
  swiper.addEventListener("pointerleave", finishDrag);

  window.addEventListener("resize", syncTrackHeight, { passive: true });
  updateSlides();
  resetAutoplay();
}

document.addEventListener("DOMContentLoaded", initSpacesSwiper);

function initMembershipPlans() {
  const tabs = Array.from(document.querySelectorAll("[data-membership-tab]"));
  const grid = document.querySelector("[data-membership-grid]");
  if (!tabs.length || !grid) return;

  const planGroups = {
    monthly: {
      columns: 2,
      cards: [
        {
          name: "Kora",
          note: "The Essentialist",
          price: "Rs. 19,000",
          unit: "Per month",
          features: [
            "Unlimited Classes + 3 day advance Priority Booking",
            "Unlimited Sauna/Cold Plunge/jacuzzi/Heated Swimming Pool",
            "10% Disc. + 30min KORA Welcome complimentary (Head & Shoulder or Foot) at NAUD Thai Spa by Kora",
            "1 x Comp. physio Consultation",
            "3 Guest Passes/ month",
            "2.5k credit + 10% Discount at Cafe",
          ],
        },
        {
          name: "Kora Plus",
          note: "The Enhanced",
          price: "Rs. 24,000",
          unit: "Per month",
          features: [
            "Unlimited Classes + 7 Day advance Priority Booking",
            "Unlimited Sauna/Cold Plunge/jacuzzi/Heated Swimming Pool",
            "20% Disc. + 1 free KORA massages  at NAUD Thai Spa by Kora",
            "2 x Comp. physio Consultation",
            "4 Guest Passes/ month (Share Spa)",
            "4.5k credit + 15% Discount at Cafe",
          ],
        },
      ],
    },
    quarterly: {
      columns: 2,
      cards: [
        {
          name: "Kora",
          note: "The Essentialist",
          price: "Rs. 51,300",
          unit: "Per month",
          features: [
            "Unlimited classes +  3 day advance priority booking",
            "Unlimited Sauna/Cold Plunge/Jacuzzi/Heated Swimming Pool",
            "10% Disc. + 1 time 30min KORA Welcome complimentary (Head & Shoulder or Foot) at NAUD Thai Spa by Kora",
            "3 x Comp. physio Consultation",
            "3 Guest Passes",
            "2.5k credit + 10% Discount at Cafe",
          ],
        },
        {
          name: "Kora Plus",
          note: "The Enhanced",
          price: "Rs. 64,800",
          unit: "Per month",
          features: [
            "Unlimited Classes + 7 Day advance Priority Booking",
            "Unlimited Sauna/Cold Plunge/Jacuzzi/Heated Swimming Pool",
            "20% Disc. + 3 free KORA massages at NAUD Thai Spa by Kora",
            "2 x Comp. physio consultation monthly ( 6 x comp physio consultation in total)",
            "4 Guest Passes (Share Spa)",
            "4.5k credit + 15% Discount at Cafe"
          ],
        },
      ],
    },
    yearly: {
      columns: 3,
      cards: [
        {
          name: "Kora",
          note: "The Essentialist",
          price: "Rs. 2,09,000",
          unit: "Per month",
          features: [
            "Unlimited Classes +  3 day advance Priority Booking",
            "Unlimited Sauna/Cold Plunge/Jacuzzi/Heated Swimming Pool",
            "10% Disc. + 30min KORA Welcome complimentary (Head & Shoulder or Foot) at NAUD Thai Spa by Kora",
            "1 x Comp. physio consultation per month",
            "3 Guest Passes",
            "3k credit + 12% Discount at Cafe",
          ],
        },
        {
          name: "Kora Plus",
          note: "The Enhanced",
          price: "Rs. 2,64,000",
          unit: "Per month",
          features: [
            "Unlimited Classes + 7 Day advance Priority Booking",
            "Unlimited Sauna/Cold Plunge/jacuzzi/Heated Swimming Pool",
            "20% Disc. + 1 free KORA massages at NAUD Thai Spa by Kora",
            "2 x Comp. physio consultation per month",
            "4 Guest Passes/ month (Share Spa)",
            "4.5k credit + 15% Discount at Cafe",
            "30 Days freeze policy",
          ],
        },
        {
          name: "Kora 100",
          note: "The Centum",
          price: "Rs. 72,000",
          unit: "Per year",
          features: [
            "Unlimited Classes + 3 day advance Priority Booking",
            "Unlimited Sauna/Cold Plunge/jacuzzi/Heated Swimming Pool",
            "12% Disc. + 30min KORA Welcome complimentary (Head & Shoulder or Foot) at NAUD Thai Spa by Kora",
            "2 x Comp. physio Consultation",
            "3 Guest Passes",
            "3k credit + 12% Discount at Cafe",
          ],
        },
      ],
    },
    daypasses: {
      columns: 3,
      cards: [
        {
          name: "1-Day Pass",
          note: "",
          price: "Rs. 2,000",
          unit: "Per pass",
          features: [
            "All classes access",
            "Unlimited sauna, cold plunge, jacuzzi, heated swimming pool",
            "10% discount (cafe/spa/salon)",
            "Towel & locker included",
          ],
        },
        {
          name: "3-Day Pass",
          note: "",
          price: "Rs. 4,500",
          unit: "Per pass",
         features: [
            "All classes access",
            "Unlimited sauna, cold plunge, jacuzzi, heated swimming pool",
            "10% discount (cafe/spa/salon)",
            "Towel & locker included",
          ],
        },
        {
          name: "7-Day Pass",
          note: "",
          price: "Rs. 8,000",
          unit: "Per pass",
          features: [
            "All classes access",
            "Unlimited sauna, cold plunge, jacuzzi, heated swimming pool",
            "10% discount (cafe/spa/salon)",
            "Towel & locker included",
          ],
        },
      ],
    },
  };

  function renderCards(key) {
    const current = planGroups[key];
    if (!current) return;

    grid.style.setProperty("--membership-columns", current.columns);
    grid.innerHTML = current.cards
      .map(
        (card) => `
          <article class="membership-card">
            <div class="membership-card-top">
              <div>
                <p class="membership-card-name">${card.name}</p>
                <p class="membership-card-note">${card.note}</p>
              </div>
            </div>
            <p class="membership-price">${card.price}<span class="membership-unit">${card.unit}</span></p>
            <div class="membership-divider" aria-hidden="true"></div>
            <ul class="membership-features">
              ${card.features.map((feature) => `<li>${feature}</li>`).join("")}
            </ul>
          </article>
        `,
      )
      .join("");
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const key = tab.dataset.membershipTab;
      tabs.forEach((item) => {
        const isActive = item === tab;
        item.classList.toggle("is-active", isActive);
        item.setAttribute("aria-selected", isActive ? "true" : "false");
      });
      renderCards(key);
    });
  });

  renderCards("monthly");
}

document.addEventListener("DOMContentLoaded", initMembershipPlans);

function initWaitlistScroll() {
  const ctaButton = document.querySelector("[data-scroll-to-signup]");
  const signup = document.getElementById("signup");
  if (!ctaButton || !signup) return;

  ctaButton.addEventListener("click", (event) => {
    event.preventDefault();
    signup.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

document.addEventListener("DOMContentLoaded", initWaitlistScroll);

function initScrollReveals() {
  const revealItems = document.querySelectorAll(".reveal-on-scroll");
  if (!revealItems.length) return;

  if (!("IntersectionObserver" in window)) {
    revealItems.forEach((item) => item.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.18, rootMargin: "0px 0px -8% 0px" },
  );

  revealItems.forEach((item) => observer.observe(item));
}

document.addEventListener("DOMContentLoaded", initScrollReveals);

initAnimations();
document.addEventListener("DOMContentLoaded", initParallax);
