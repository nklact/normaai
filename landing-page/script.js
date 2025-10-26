// Smooth scrolling for navigation links
document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
  anchor.addEventListener("click", function (e) {
    e.preventDefault();
    const target = document.querySelector(this.getAttribute("href"));
    if (target) {
      const headerOffset = 80;
      const elementPosition = target.getBoundingClientRect().top;
      const offsetPosition =
        elementPosition + window.pageYOffset - headerOffset;

      window.scrollTo({
        top: offsetPosition,
        behavior: "smooth",
      });
    }
  });
});

// Sticky navbar on scroll and active menu highlighting
function handleNavbarScroll() {
  const navbar = document.querySelector(".navbar");
  const navbarHeight = navbar.offsetHeight;

  if (window.scrollY > navbarHeight) {
    navbar.classList.add("sticky");
    navbar.style.background = "rgba(255, 255, 255, 0.98)";
  } else {
    navbar.classList.remove("sticky");
    navbar.style.background = "rgba(255, 255, 255, 0.95)";
  }

  // Update active menu item based on scroll position
  updateActiveMenuItem();
}

// Update active menu item based on current section in view
function updateActiveMenuItem() {
  const sections = document.querySelectorAll("section[id]");
  const navLinks = document.querySelectorAll('.nav-links a[href^="#"]');

  let current = "";
  const scrollPosition = window.scrollY + 120; // Offset for navbar height

  // Find which section is currently in view
  sections.forEach((section) => {
    const sectionTop = section.offsetTop;
    const sectionHeight = section.offsetHeight;

    if (
      scrollPosition >= sectionTop &&
      scrollPosition < sectionTop + sectionHeight
    ) {
      current = section.getAttribute("id");
    }
  });

  // If we're at the very top, default to home
  if (window.scrollY < 50) {
    current = "home";
  }

  // Update active class on navigation links
  navLinks.forEach((link) => {
    link.classList.remove("active");
    if (link.getAttribute("href") === `#${current}`) {
      link.classList.add("active");
    }
  });
}

window.addEventListener("scroll", handleNavbarScroll);

// Mobile menu toggle
const hamburger = document.querySelector(".hamburger");
const navLinks = document.querySelector(".nav-links");

if (hamburger && navLinks) {
  hamburger.addEventListener("click", function () {
    navLinks.classList.toggle("nav-links-mobile");
    hamburger.classList.toggle("hamburger-active");
  });
}

// Scroll animations
function handleScrollAnimations() {
  const elements = document.querySelectorAll(".scroll-animate");

  elements.forEach((element) => {
    const elementTop = element.getBoundingClientRect().top;
    const elementVisible = 150;

    if (elementTop < window.innerHeight - elementVisible) {
      element.classList.add("in-view");
    }
  });
}

window.addEventListener("scroll", handleScrollAnimations);

// Initialize scroll animations on page load
document.addEventListener("DOMContentLoaded", function () {
  // Add scroll-animate class to elements that should animate
  const animateElements = [
    ".feature-card",
    ".step",
    ".testimonial-card",
    ".comparison-table",
  ];

  animateElements.forEach((selector) => {
    document.querySelectorAll(selector).forEach((element) => {
      element.classList.add("scroll-animate");
    });
  });

  // Trigger initial animation check
  handleScrollAnimations();

  // Add staggered animation delays
  document
    .querySelectorAll(".features-grid .feature-card")
    .forEach((card, index) => {
      card.style.animationDelay = `${index * 100}ms`;
    });

  document
    .querySelectorAll(".testimonials-grid .testimonial-card")
    .forEach((card, index) => {
      card.style.animationDelay = `${index * 150}ms`;
    });
});

// Typing animation for hero
function typeWriter(element, text, speed = 100) {
  let i = 0;
  element.innerHTML = "";

  function type() {
    if (i < text.length) {
      element.innerHTML += text.charAt(i);
      i++;
      setTimeout(type, speed);
    }
  }
  type();
}

// Initialize typing animation when page loads
window.addEventListener("load", function () {
  const aiMessage = document.querySelector(".message.ai");
  if (aiMessage) {
    const originalText = aiMessage.textContent;
    setTimeout(() => {
      typeWriter(aiMessage, originalText, 50);
    }, 1000);
  }
});

// Counter animation for stats
function animateCounters() {
  const counters = document.querySelectorAll(".stat-number");

  counters.forEach((counter) => {
    const target =
      counter.getAttribute("data-target") ||
      counter.textContent.replace(/[^\d]/g, "");
    const duration = 2000;
    const start = 0;
    const increment = target / (duration / 16);
    let current = start;

    const updateCounter = () => {
      current += increment;
      if (current < target) {
        counter.textContent =
          Math.floor(current).toLocaleString() +
          (counter.textContent.includes("+") ? "+" : "");
        requestAnimationFrame(updateCounter);
      } else {
        counter.textContent =
          target + (counter.textContent.includes("+") ? "+" : "");
      }
    };

    // Start animation when element comes into view
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          updateCounter();
          observer.unobserve(entry.target);
        }
      });
    });

    observer.observe(counter);
  });
}

// Initialize counter animations
document.addEventListener("DOMContentLoaded", animateCounters);

// Parallax effect removed - hero section should stay fixed

// Add floating animation to hero card
document.addEventListener("DOMContentLoaded", function () {
  const heroCard = document.querySelector(".hero-card");
  if (heroCard) {
    heroCard.style.animation = "float 6s ease-in-out infinite";
  }
});

// Add CSS for floating animation
const floatingCSS = `
@keyframes float {
    0%, 100% { transform: translateY(0px) rotate(0deg); }
    25% { transform: translateY(-10px) rotate(1deg); }
    50% { transform: translateY(5px) rotate(0deg); }
    75% { transform: translateY(-5px) rotate(-1deg); }
}
`;

const style = document.createElement("style");
style.textContent = floatingCSS;
document.head.appendChild(style);

// Form handling (if you add forms later)
function handleFormSubmission() {
  const forms = document.querySelectorAll("form");

  forms.forEach((form) => {
    form.addEventListener("submit", function (e) {
      e.preventDefault();

      // Add loading state
      const submitButton = form.querySelector('button[type="submit"]');
      const originalText = submitButton.textContent;
      submitButton.textContent = "Šalje se...";
      submitButton.disabled = true;

      // Simulate form submission
      setTimeout(() => {
        submitButton.textContent = "Poslano!";
        setTimeout(() => {
          submitButton.textContent = originalText;
          submitButton.disabled = false;
        }, 2000);
      }, 1500);
    });
  });
}

// Initialize form handling
document.addEventListener("DOMContentLoaded", handleFormSubmission);

// FAQ accordion functionality
function initializeFAQ() {
  const faqQuestions = document.querySelectorAll(".faq-question");

  faqQuestions.forEach((question) => {
    question.addEventListener("click", () => {
      const faqNumber = question.getAttribute("data-faq");
      const faqItem = question.closest(".faq-item");
      const faqAnswer = document.querySelector(`[data-answer="${faqNumber}"]`);
      const isActive = faqItem.classList.contains("active");

      // Close all other FAQ items
      document.querySelectorAll(".faq-item").forEach((item) => {
        if (item !== faqItem) {
          item.classList.remove("active");
          const answer = item.querySelector(".faq-answer");
          answer.classList.remove("active");
        }
      });

      // Toggle current FAQ item
      if (isActive) {
        faqItem.classList.remove("active");
        faqAnswer.classList.remove("active");
      } else {
        faqItem.classList.add("active");
        faqAnswer.classList.add("active");
      }
    });
  });
}

// Initialize FAQ on page load
document.addEventListener("DOMContentLoaded", initializeFAQ);

// Add hover effects for interactive elements
document.addEventListener("DOMContentLoaded", function () {
  // Add subtle hover animations to cards
  const cards = document.querySelectorAll(".feature-card, .testimonial-card");

  cards.forEach((card) => {
    card.addEventListener("mouseenter", function () {
      this.style.transform = "translateY(-8px) scale(1.02)";
    });

    card.addEventListener("mouseleave", function () {
      this.style.transform = "translateY(0) scale(1)";
    });
  });

  // Add ripple effect to buttons
  const buttons = document.querySelectorAll(".btn-primary, .btn-secondary");

  buttons.forEach((button) => {
    button.addEventListener("click", function (e) {
      const ripple = document.createElement("span");
      const rect = this.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      const x = e.clientX - rect.left - size / 2;
      const y = e.clientY - rect.top - size / 2;

      ripple.style.cssText = `
                position: absolute;
                width: ${size}px;
                height: ${size}px;
                left: ${x}px;
                top: ${y}px;
                background: rgba(255, 255, 255, 0.3);
                border-radius: 50%;
                pointer-events: none;
                transform: scale(0);
                animation: ripple 0.6s linear;
            `;

      this.style.position = "relative";
      this.style.overflow = "hidden";
      this.appendChild(ripple);

      setTimeout(() => {
        ripple.remove();
      }, 600);
    });
  });
});

// Add ripple animation CSS
const rippleCSS = `
@keyframes ripple {
    to {
        transform: scale(4);
        opacity: 0;
    }
}
`;

const rippleStyle = document.createElement("style");
rippleStyle.textContent = rippleCSS;
document.head.appendChild(rippleStyle);

// Lazy loading for images (if you add images later)
function handleLazyLoading() {
  const images = document.querySelectorAll("img[data-src]");

  const imageObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const img = entry.target;
        img.src = img.dataset.src;
        img.classList.remove("lazy");
        imageObserver.unobserve(img);
      }
    });
  });

  images.forEach((img) => imageObserver.observe(img));
}

document.addEventListener("DOMContentLoaded", handleLazyLoading);

// Pricing toggle functionality
function initializePricingToggle() {
  const toggle = document.getElementById("pricing-toggle");
  const monthlyLabels = document.querySelectorAll(".toggle-label:first-child");
  const yearlyLabels = document.querySelectorAll(".toggle-label:last-child");
  const monthlyPrices = document.querySelectorAll(
    ".monthly-price, .monthly-period"
  );
  const yearlyPrices = document.querySelectorAll(
    ".yearly-price, .yearly-period, .yearly-note, .yearly-savings"
  );

  if (!toggle) return;

  function updateLabels() {
    monthlyLabels.forEach((label) => {
      label.classList.toggle("active", !toggle.checked);
    });
    yearlyLabels.forEach((label) => {
      label.classList.toggle("active", toggle.checked);
    });
  }

  function updatePrices() {
    monthlyPrices.forEach((price) => {
      price.style.display = toggle.checked ? "none" : "block";
    });
    yearlyPrices.forEach((price) => {
      price.style.display = toggle.checked ? "block" : "none";
    });
  }

  // Initialize
  updateLabels();
  updatePrices();

  // Add event listener
  toggle.addEventListener("change", () => {
    updateLabels();
    updatePrices();
  });
}

document.addEventListener("DOMContentLoaded", initializePricingToggle);
