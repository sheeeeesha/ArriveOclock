// ===========================================================================
// Landing-page scroll experience (web only, lazy-loaded). GSAP + ScrollTrigger
// and friends are bundled (CSP forbids CDN scripts). Everything is wrapped so a
// failure never leaves content hidden — reveal targets are only hidden by JS.
// ===========================================================================
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ScrollToPlugin } from 'gsap/ScrollToPlugin';
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin';
import { MotionPathPlugin } from 'gsap/MotionPathPlugin';
import { SplitText } from 'gsap/SplitText';
import { joinWaitlist } from './db.js';

gsap.registerPlugin(ScrollTrigger, ScrollToPlugin, DrawSVGPlugin, MotionPathPlugin, SplitText);

const q = (s, r = document) => r.querySelector(s);
const qa = (s, r = document) => Array.from(r.querySelectorAll(s));
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

function buildClockTicks() {
  const g = q('.lp-ticks');
  if (!g) return;
  let m = '';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const r1 = 188, r2 = i % 3 === 0 ? 168 : 176;
    const x1 = 200 + Math.sin(a) * r1, y1 = 200 - Math.cos(a) * r1;
    const x2 = 200 + Math.sin(a) * r2, y2 = 200 - Math.cos(a) * r2;
    m += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="var(--line-strong)" stroke-width="${i % 3 === 0 ? 3 : 1.5}" stroke-linecap="round"/>`;
  }
  g.innerHTML = m;
}

function wireWaitlist() {
  const form = q('#lpForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = q('#lpEmail');
    const email = (input?.value || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      if (input) input.style.borderColor = 'var(--text)';
      if (!reduce) gsap.fromTo(form, { x: -8 }, { x: 0, duration: .5, ease: 'elastic.out(1,0.3)' });
      input?.focus();
      return;
    }
    try { await joinWaitlist(email); } catch { /* best effort */ }
    form.innerHTML = "<div class=\"lp-done\">✓ You're on the list — we'll email you the moment the app launches.</div>";
    if (!reduce) gsap.from(form.firstChild, { y: 12, opacity: 0, duration: .6, ease: 'power3.out' });
  });
}

function wireScrollCtas() {
  qa('[data-lp-scroll]').forEach((b) =>
    b.addEventListener('click', () => {
      if (reduce) { q('#lp-join')?.scrollIntoView({ behavior: 'smooth' }); return; }
      gsap.to(window, { duration: 1, scrollTo: { y: '#lp-join', offsetY: 12 }, ease: 'power2.inOut' });
    })
  );
}

export function initLanding() {
  try {
    buildClockTicks();
    wireWaitlist();
    wireScrollCtas();

    if (reduce) return; // honour reduced-motion: no scrubbing/pinning

    // --- Scroll progress bar --------------------------------------------------
    gsap.to('.lp-progress', {
      scaleX: 1, ease: 'none',
      scrollTrigger: { trigger: '#landingPage', start: 'top top', end: 'bottom bottom', scrub: true },
    });

    // --- Hero entrance --------------------------------------------------------
    let lines = [q('.lp-h1')];
    try { lines = new SplitText('.lp-h1', { type: 'lines' }).lines; } catch { /* keep whole */ }
    gsap.timeline({ defaults: { ease: 'power3.out', duration: .8 } })
      .from('.lp-kicker', { y: 22, opacity: 0, duration: .6 })
      .from(lines, { yPercent: 60, opacity: 0, stagger: .12 }, '-=.3')
      .from('.lp-hero .lp-sub', { y: 18, opacity: 0, duration: .6 }, '-=.45')
      .from('.lp-hero .lp-actions', { y: 18, opacity: 0, duration: .6 }, '-=.4')
      .from('.lp-hero .lp-fine', { opacity: 0, duration: .5 }, '-=.4')
      .from('.lp-phone', { y: 48, opacity: 0, scale: .94, duration: 1 }, '-=.9')
      .from('.lp-scrollcue', { opacity: 0, duration: .5 }, '-=.3');

    // --- Hero parallax + rotating clock --------------------------------------
    const heroST = { trigger: '.lp-hero', start: 'top top', end: 'bottom top', scrub: true };
    gsap.to('.lp-hero-clock', { yPercent: 24, rotation: 26, ease: 'none', scrollTrigger: heroST });
    gsap.to('.lp-grid', { yPercent: 14, ease: 'none', scrollTrigger: heroST });
    gsap.to('.lp-phonewrap', { yPercent: -14, ease: 'none', scrollTrigger: heroST });
    const pageST = { trigger: '#landingPage', start: 'top top', end: 'bottom bottom', scrub: 1 };
    gsap.to('.lp-hand-m', { rotation: 360, transformOrigin: '200px 200px', ease: 'none', scrollTrigger: pageST });
    gsap.to('.lp-hand-h', { rotation: 90, transformOrigin: '200px 200px', ease: 'none', scrollTrigger: pageST });

    // --- Marquee: constant drift + velocity-driven skew ----------------------
    const track = q('.lp-marquee-track');
    if (track) {
      gsap.to(track, { xPercent: -50, repeat: -1, duration: 22, ease: 'none' });
      const skewTo = gsap.quickTo(track, 'skewX', { duration: .5, ease: 'power3' });
      ScrollTrigger.create({
        trigger: '.lp-marquee', start: 'top bottom', end: 'bottom top',
        onUpdate: (self) => skewTo(gsap.utils.clamp(-14, 14, self.getVelocity() / -120)),
      });
    }

    // --- Scroll reveals via IntersectionObserver -----------------------------
    // Robust across pinned-section refreshes (unlike gsap.from + ScrollTrigger,
    // whose positions go stale below pins). Class is added by JS so content is
    // never hidden when JS is absent.
    const revealEls = qa('.lp-eyebrow, .lp-h2, .lp-features .lp-card, .lp-stat, .lp-join-sub');
    revealEls.forEach((el) => el.classList.add('lp-anim'));
    qa('.lp-features .lp-card').forEach((el, i) => { el.style.transitionDelay = (i * 0.1) + 's'; });
    qa('.lp-stat').forEach((el, i) => { el.style.transitionDelay = (i * 0.1) + 's'; });
    const io = new IntersectionObserver((ents) => {
      ents.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('lp-in'); io.unobserve(e.target); } });
    }, { threshold: 0.18, rootMargin: '0px 0px -6% 0px' });
    revealEls.forEach((el) => io.observe(el));

    // --- Journey: pinned, route draws + pin travels + steps reveal -----------
    if (q('.lp-journey-pin') && q('#lp-route-line')) {
      const jtl = gsap.timeline({
        scrollTrigger: {
          trigger: '.lp-journey-pin', start: 'top top',
          // px from the viewport, never a % of the (spacer-inflated) trigger.
          end: () => '+=' + Math.round(window.innerHeight * 2.8),
          scrub: 1.1, pin: true, anticipatePin: 1, invalidateOnRefresh: true, refreshPriority: 2,
        },
      });
      gsap.set('.lp-jstep', { opacity: .2, y: 18 });
      // The route is two symmetric cubic segments, so its three dots sit at 0,
      // 0.5 and 1 along the path. Giving the draw and the pin an explicit
      // duration of 1 — and placing each step at its dot's position — means a
      // step lights exactly as the pin reaches it. Previously both tweens used
      // GSAP's default 0.5s while the steps ran on a 0.45 stagger out to 1.45,
      // so the route finished in the first third and the steps drifted on
      // afterwards, unsynchronised.
      const steps = qa('.lp-jstep');
      jtl.fromTo('#lp-route-line', { drawSVG: '0%' }, { drawSVG: '100%', ease: 'none', duration: 1 }, 0)
         .to('#lp-route-pin', {
           motionPath: { path: '#lp-route-line', align: '#lp-route-line', alignOrigin: [0.5, 1] },
           ease: 'none', duration: 1,
         }, 0)
         .to(steps[0], { opacity: 1, y: 0, duration: .16, ease: 'power2.out' }, 0)
         .to(steps[1], { opacity: 1, y: 0, duration: .16, ease: 'power2.out' }, 0.5)
         .to(steps[2], { opacity: 1, y: 0, duration: .16, ease: 'power2.out' }, 0.9);
    }

    // --- Pinned statement scale-in ------------------------------------------
    if (q('.lp-statement-text')) {
      gsap.fromTo('.lp-statement-text', { scale: .55, opacity: .12 }, {
        scale: 1, opacity: 1, ease: 'none',
        scrollTrigger: {
          trigger: '.lp-statement', start: 'top top',
          end: () => '+=' + Math.round(window.innerHeight * 1.9),
          scrub: true, pin: true, invalidateOnRefresh: true, refreshPriority: 1,
        },
      });
    }

    // --- Count-up stats (IntersectionObserver, same robustness reason) -------
    const countIO = new IntersectionObserver((ents) => {
      ents.forEach((e) => {
        if (!e.isIntersecting) return;
        const el = e.target;
        const end = +el.dataset.count || 0;
        const suffix = el.dataset.suffix || '';
        const o = { v: 0 };
        el.textContent = '0' + suffix;
        gsap.to(o, { v: end, duration: 1.6, ease: 'power2.out',
          onUpdate: () => { el.textContent = Math.round(o.v) + suffix; },
          onComplete: () => { el.textContent = end + suffix; } });
        countIO.unobserve(el);
      });
    }, { threshold: 0.6 });
    qa('.lp-stat-num').forEach((el) => countIO.observe(el));

    // --- Magnetic primary buttons (hover-capable devices only) ---------------
    if (matchMedia('(hover: hover)').matches) {
      qa('.lp-btn-lg').forEach((btn) => {
        const xTo = gsap.quickTo(btn, 'x', { duration: .4, ease: 'power3' });
        const yTo = gsap.quickTo(btn, 'y', { duration: .4, ease: 'power3' });
        btn.addEventListener('pointermove', (e) => {
          const r = btn.getBoundingClientRect();
          xTo((e.clientX - (r.left + r.width / 2)) * .3);
          yTo((e.clientY - (r.top + r.height / 2)) * .5);
        });
        btn.addEventListener('pointerleave', () => { xTo(0); yTo(0); });
      });
    }

    // Recompute once things settle, and on resize since the pin ends are derived
    // from innerHeight. Debounced — repeated refreshes are what let the old
    // percentage-based ends compound in the first place.
    let refreshT = null;
    const refresh = () => {
      clearTimeout(refreshT);
      refreshT = setTimeout(() => ScrollTrigger.refresh(), 200);
    };
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(refresh);
    window.addEventListener('load', refresh);
    window.addEventListener('resize', refresh);
  } catch (err) {
    // Never let an animation error hide the page.
    if (window.console) console.warn('landing animations skipped:', err);
  }
}
