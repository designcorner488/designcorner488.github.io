/* ============================================================
   PORTFOLIO SCRIPT — Dynamic JSON + All Visual Effects
   Loader · Particles · Cursor · AOS · Lightbox · Gallery
   ============================================================ */

const REPO_OWNER = 'designcorner488';
const REPO_NAME  = 'designcorner488.github.io';
const BRANCH     = 'master';
const DATA_URL   = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/portfolio.json?nocache=${Date.now()}`;

let portfolioData   = null;
let filteredProjects= [];
let currentLBIndex  = 0;
let visibleCount    = 12;
const PAGE_SIZE     = 12;

let editMode = false;
let currentSocialPlatform = '';
let currentSoftwareTags = ['Blender', 'Revit', 'D5 Render', 'Animation'];
let authSuccessCallback = null;


/* ============================================================
   PUBLISH TO GITHUB — via local Publish Server (no token needed)
   Desktop par "Publish Website.bat" chalayein, phir button dabayein.
   ============================================================ */
const PUBLISH_SERVER = 'http://localhost:7788';

function closeGhTokenModal() {
  const m = document.getElementById('ghTokenModal');
  if (m) m.style.display = 'none';
}

function buildPublishPayload() {
  const updatedJson = JSON.parse(JSON.stringify(portfolioData || {}));
  updatedJson.settings = updatedJson.settings || {};
  const heroLine2  = document.querySelector('[data-key="heroLine2"]')?.textContent?.trim();
  const heroDesc   = document.querySelector('[data-key="heroDesc"]')?.textContent?.trim();
  const aboutText  = document.querySelector('[data-key="aboutText"]')?.textContent?.trim();
  const aboutTitle = document.querySelector('[data-key="aboutTitle"]')?.textContent?.trim();
  const contactEm  = document.querySelector('[data-key="contactEmail"]')?.textContent?.trim();
  const contactPh  = document.querySelector('[data-key="contactPhone"]')?.textContent?.trim();
  const navName = document.querySelector('[data-key="navName"]')?.textContent?.trim();
  if (navName) updatedJson.settings.name = navName;
  else if (aboutTitle) updatedJson.settings.name = aboutTitle;
  if (heroLine2)  updatedJson.settings.tagline = heroLine2;
  if (heroDesc)   updatedJson.settings.title   = heroDesc;
  if (aboutText)  updatedJson.settings.about   = aboutText;
  if (contactEm)  updatedJson.settings.email   = contactEm;
  if (contactPh)  updatedJson.settings.phone   = contactPh;
  if (currentSoftwareTags && currentSoftwareTags.length)
    updatedJson.settings.softwareTags = currentSoftwareTags;
  const saved = getSavedData();
  if (saved.text) updatedJson._textOverrides = saved.text;
  if (saved.scifiAvatar) updatedJson.settings.scifiAvatar = saved.scifiAvatar;
  const savedSkillMedia = saved.skillMedia || portfolioData?.settings?.skillMedia;
  if (savedSkillMedia) updatedJson.settings.skillMedia = savedSkillMedia;
  if (typeof getAddons === 'function') updatedJson.addons = getAddons();
  if (typeof getProjects === 'function') updatedJson.projects = getProjects();
  return updatedJson;
}

async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function publishToGitHub() {
  const btn = document.getElementById('btnPublish');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Preparing...'; }

  // --- Check if server is running ---
  let serverRunning = false;
  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 2500);
    const ping = await fetch(PUBLISH_SERVER + '/ping', { signal: ctrl.signal }).catch(() => null);
    clearTimeout(tid);
    serverRunning = !!(ping && ping.ok);
  } catch(e) { serverRunning = false; }

  if (!serverRunning) {
    const token = localStorage.getItem('cms_gh_token');
    if (token) {
      try {
        if (btn) btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> GitHub API se publish...';
        showToast('☁️ GitHub API se live update ho raha hai...', 'success');
        const portfolio = buildPublishPayload();
        const fileRes = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/portfolio.json`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        let sha = null;
        if (fileRes.ok) {
          const fileJson = await fileRes.json();
          sha = fileJson.sha;
        }
        const jsonString = JSON.stringify(portfolio, null, 2);
        const base64Json = btoa(unescape(encodeURIComponent(jsonString)));
        const putRes = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/portfolio.json`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            message: 'Live website update via Edit Mode',
            content: base64Json,
            sha: sha,
            branch: BRANCH
          })
        });
        if (putRes.ok) {
          showToast('🚀 Live website publish ho gayi! 1-2 min mein update nazar aayega.');
          if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> Publish Live'; }
          return;
        }
      } catch (err) {
        console.warn('API publish fallback error:', err);
      }
    }

    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> Publish Live'; }
    const modal = document.getElementById('ghTokenModal');
    if (modal) modal.style.display = 'flex';
    return;
  }

  // --- Build portfolio data ---
  const portfolio = buildPublishPayload();

  // --- Smart Delta Sync: Only upload NEW media files ---
  if (btn) btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Checking changes...';
  const idbItems = await dbGetAllItems();
  const mediaPayload = [];
  let skipped = 0;

  // Track what is ALREADY published in portfolio.json
  const publishedMap = new Map();
  (portfolioData?._media || []).forEach(m => {
    if (m && m.name) publishedMap.set(m.name, m);
  });

  const activeMediaList = [];

  for (const item of idbItems) {
    if (!item.blob) continue;
    const sizeMB = item.blob.size / (1024 * 1024);
    if (sizeMB > 95) { skipped++; continue; }

    const ext  = item.type === 'glb' ? '.glb' : '.mp4';
    const safe = (item.name || 'media').replace(/[^a-zA-Z0-9._-]/g, '_') + ext;

    if (publishedMap.has(safe)) {
      // Reuse existing published link — ZERO wait, ZERO re-upload!
      activeMediaList.push(publishedMap.get(safe));
    } else {
      // Brand new file — upload it
      try {
        const b64 = await blobToBase64(item.blob);
        mediaPayload.push({
          name: safe,
          displayName: item.name,
          type: item.type,
          dataBase64: b64,
          size: item.blob.size
        });
      } catch(e) { console.warn('blob convert error:', e); }
    }
  }

  portfolio._media = activeMediaList;
  if (skipped > 0) showToast(`⚠️ ${skipped} file(s) 95MB+ — skip ho gaye (too large)`, 'error');

  // --- Send to publish server ---
  if (mediaPayload.length > 0) {
    if (btn) btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${mediaPayload.length} new file(s) push...`;
    showToast(`☁️ ${mediaPayload.length} nayi media file(s) upload ho rahi hain...`, 'success');
  } else {
    if (btn) btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Live sync...';
    showToast('⚡ Instant Sync: Sirf new edits push ho rahe hain...', 'success');
  }

  try {
    const res  = await fetch(PUBLISH_SERVER + '/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ portfolio, media: mediaPayload })
    });
    const json = await res.json();
    if (json.ok) {
      if (mediaPayload.length > 0) {
        showToast(`🚀 Published! ${mediaPayload.length} nayi file(s) live. 1-2 min mein update!`);
      } else {
        showToast('⚡ Published instantly! Tamam edits live ho gaye.');
      }
      if (json.media) {
        portfolioData._media = json.media;
      }
    } else {
      showToast('❌ Publish fail: ' + (json.message || 'unknown'), 'error');
    }
  } catch(e) {
    showToast('❌ Network error: ' + e.message, 'error');
  }

  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> Publish Live'; }
}

/* ============================================================
   LOADER
   ============================================================ */
function initLoader() {
  const loader = document.getElementById('loader');
  if (loader) {
    loader.classList.add('hidden');
    loader.style.display = 'none';
  }
}

/* ============================================================
   CUSTOM CURSOR
   ============================================================ */
function initCursor() {
  const cursor   = document.getElementById('cursor');
  const follower = document.getElementById('cursorFollower');
  if (!cursor || !follower) return;

  let mx = 0, my = 0, fx = 0, fy = 0;

  document.addEventListener('mousemove', e => {
    mx = e.clientX; my = e.clientY;
    cursor.style.left   = mx + 'px';
    cursor.style.top    = my + 'px';
  });

  (function animFollower() {
    fx += (mx - fx) * 0.12;
    fy += (my - fy) * 0.12;
    follower.style.left = fx + 'px';
    follower.style.top  = fy + 'px';
    requestAnimationFrame(animFollower);
  })();

  document.querySelectorAll('a, button, .filter-btn, .gallery-masonry-item, .gmi-item')
    .forEach(el => {
      el.addEventListener('mouseenter', () => {
        cursor.style.width   = '20px';
        cursor.style.height  = '20px';
        cursor.style.background = 'var(--gold)';
        follower.style.width  = '56px';
        follower.style.height = '56px';
        follower.style.borderColor = 'rgba(245,158,11,.4)';
      });
      el.addEventListener('mouseleave', () => {
        cursor.style.width   = '10px';
        cursor.style.height  = '10px';
        cursor.style.background = 'var(--accent2)';
        follower.style.width  = '36px';
        follower.style.height = '36px';
        follower.style.borderColor = 'rgba(168,85,247,.5)';
      });
    });
}

/* ============================================================
   PARTICLE CANVAS
   ============================================================ */
function initParticles() {
  const canvas = document.getElementById('particleCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let W, H, particles = [];

  function resize() {
    W = canvas.width  = canvas.offsetWidth;
    H = canvas.height = canvas.offsetHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  function Particle() {
    this.reset = function() {
      this.x  = Math.random() * W;
      this.y  = Math.random() * H;
      this.r  = Math.random() * 1.5 + 0.3;
      this.vx = (Math.random() - 0.5) * 0.4;
      this.vy = (Math.random() - 0.5) * 0.4;
      this.alpha = Math.random() * 0.5 + 0.1;
      const colors = ['168,85,247', '124,58,237', '6,182,212', '245,158,11', '16,185,129'];
      this.color = colors[Math.floor(Math.random() * colors.length)];
    };
    this.reset();
  }

  for (let i = 0; i < 40; i++) { const p = new Particle(); particles.push(p); }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    particles.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > W || p.y < 0 || p.y > H) p.reset();
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${p.color},${p.alpha})`;
      ctx.fill();
    });

    // Draw connecting lines
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < 100) {
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = `rgba(124,58,237,${0.08 * (1 - dist/100)})`;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }
    }
    requestAnimationFrame(draw);
  }
  draw();
}

/* ============================================================
   NAVBAR
   ============================================================ */
function initNavbar() {
  const navbar = document.getElementById('navbar');
  const links  = document.querySelectorAll('.nav-link');

  window.addEventListener('scroll', () => {
    navbar.classList.toggle('scrolled', window.scrollY > 50);
    document.getElementById('backToTop')?.classList.toggle('visible', window.scrollY > 500);

    const sections = document.querySelectorAll('section[id]');
    let current = '';
    sections.forEach(s => { if (window.scrollY >= s.offsetTop - 120) current = s.id; });
    links.forEach(l => l.classList.toggle('active', l.getAttribute('href') === '#' + current));
  });

  // Hamburger
  const ham  = document.getElementById('hamburger');
  const navL = document.getElementById('navLinks');
  if (ham && navL) {
    ham.addEventListener('click', () => navL.classList.toggle('open'));
    document.querySelectorAll('.nav-link').forEach(l => l.addEventListener('click', () => navL.classList.remove('open')));
  }

  // Back to top
  document.getElementById('backToTop')?.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

/* ============================================================
   AOS — Scroll Reveal
   ============================================================ */
function initAOS() {
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('animated'); });
  }, { threshold: 0.05 });
  document.querySelectorAll('[data-aos]').forEach(el => obs.observe(el));
  setTimeout(() => {
    document.querySelectorAll('[data-aos]').forEach(el => el.classList.add('animated'));
  }, 500);
}

/* ============================================================
   SKILL BARS
   ============================================================ */
function initSkillBars() {
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.querySelectorAll('.skill-fill').forEach(bar => {
          const w = bar.dataset.width || '0';
          setTimeout(() => { bar.style.width = w + '%'; }, 200);
        });
      }
    });
  }, { threshold: 0.3 });
  const skillsSection = document.getElementById('skills');
  if (skillsSection) obs.observe(skillsSection);
}

/* ============================================================
   COUNTERS
   ============================================================ */
function initCounters() {
  const data = getSavedData();
  if (data?.text?.statProjects || data?.text?.statClients || data?.text?.statYears) {
    // User edited stats — keep their custom numbers/text
    return;
  }
  const totalProjects = portfolioData?.projects?.length || 7;
  animateNum('stat-projects', Math.max(totalProjects, 7));
  animateNum('stat-clients',  15);
  animateNum('stat-years',    3);
}

function animateNum(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const dur = 2000;
  const start = Date.now();
  function step() {
    const p = Math.min((Date.now() - start) / dur, 1);
    const ease = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.floor(ease * target);
    if (p < 1) requestAnimationFrame(step);
  }
  step();
}

/* ============================================================
   LOAD PORTFOLIO FROM portfolio.json
   ============================================================ */
async function loadPortfolio() {
  try {
    const res = await fetch('portfolio.json?nc=' + Date.now());
    if (!res.ok) throw new Error('Local fetch failed');
    portfolioData = await res.json();
  } catch {
    try {
      const res = await fetch(DATA_URL);
      portfolioData = await res.json();
    } catch { showGalleryEmpty(); return; }
  }

  applySettings(portfolioData.settings);
  loadSavedEdits();
  buildFilterBar(portfolioData.categories);
  filteredProjects = portfolioData.projects || [];
  renderGallery();
  renderAllGallery();
  initCounters();
  try { await loadSavedMedia(); } catch(e) { console.warn(e); }
  try { initSkillShowcase(); } catch(e){ console.warn(e); }
  try { initProjectShowcaseSlider(); } catch(e){ console.warn(e); }
  setTimeout(initCursor, 100);
}

/* ============================================================
   APPLY SETTINGS
   ============================================================ */
function applySettings(s) {
  if (!s) return;
  const saved = getSavedData()?.text || {};
  const set = (id, val, key) => {
    if (key && saved[key]) return; // Respect custom edits!
    const el = document.getElementById(id);
    if (el && val) el.textContent = val;
  };
  const setHref = (id, val) => { const el = document.getElementById(id); if (el && val) el.href = val; };

  set('nav-name',    s.name || 'STUDIO', 'navName');
  set('footer-name', s.name || 'YOUR NAME', 'footerName');
  set('footer-year', new Date().getFullYear());
  set('hero-tagline', s.tagline ? s.tagline.split(' ').slice(0,2).join(' ') : '3D Visualization', 'heroLine2');
  set('hero-desc',    s.about ? s.about.split('.')[0] + '.' : '', 'heroDesc');
  set('about-title',  s.name || 'The Studio', 'aboutTitleGrad');
  set('about-text',   s.about || '', 'aboutDesc');
  set('av-initials',  getInitials(s.name || 'YN'));
  set('av-title',     s.title || 'Architecture & 3D', 'aboutBadgeTitle');
  set('cd-email',     s.email || '', 'cEmail');
  set('cd-phone',     s.phone || '', 'cPhone');
  if (s.email) setHref('cd-email-link', 'mailto:' + s.email);
  if (s.phone) setHref('cd-phone-link', 'tel:' + s.phone.replace(/\s/g, ''));
  if (s.softwareTags && Array.isArray(s.softwareTags) && s.softwareTags.length) {
    currentSoftwareTags = s.softwareTags;
    renderOrbitTags();
  }
  loadSavedEdits();
}

function getInitials(name) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

/* ============================================================
   FILTER BAR
   ============================================================ */
function buildFilterBar(categories) {
  if (!categories?.length) return;
  const bar = document.getElementById('filter-bar');
  if (!bar) return;
  bar.innerHTML = '';
  categories.forEach((cat, i) => {
    const btn = document.createElement('button');
    btn.className = 'filter-btn' + (i === 0 ? ' active' : '');
    btn.dataset.cat = cat.id;
    btn.textContent = cat.label;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      filteredProjects = cat.id === 'all' ? (portfolioData.projects || []) : (portfolioData.projects || []).filter(p => p.category === cat.id);
      if (typeof switchProjectCategory === 'function') switchProjectCategory(cat.id);
      visibleCount = PAGE_SIZE;
      renderGallery();
    });
    bar.appendChild(btn);
  });
}

/* ============================================================
   RENDER GALLERY (Projects Section)
   ============================================================ */
function renderGallery() {
  const grid     = document.getElementById('gallery-grid');
  const loading  = document.getElementById('gallery-loading');
  const empty    = document.getElementById('gallery-empty');
  const loadMore = document.getElementById('load-more-wrap');

  if (loading) loading.style.display = 'none';

  if (!filteredProjects.length) {
    if (grid) grid.innerHTML = '';
    if (empty) empty.style.display = 'block';
    if (loadMore) loadMore.style.display = 'none';
    return;
  }

  if (empty) empty.style.display = 'none';
  if (grid)  grid.innerHTML = '';

  const toShow = filteredProjects.slice(0, visibleCount);
  toShow.forEach((project, idx) => {
    const item = createMasonryItem(project, idx);
    if (grid) grid.appendChild(item);
  });

  setTimeout(() => {
    document.querySelectorAll('.gallery-masonry-item').forEach((el, i) => {
      setTimeout(() => el.classList.add('visible'), i * 60);
    });
  }, 50);

  if (loadMore) loadMore.style.display = filteredProjects.length > visibleCount ? 'block' : 'none';

  document.getElementById('load-more-btn')?.addEventListener('click', () => {
    visibleCount += PAGE_SIZE;
    renderGallery();
  });
}

function createMasonryItem(project, idx) {
  const item = document.createElement('div');
  item.className = 'gallery-masonry-item';

  const isVideo = ['youtube', 'vimeo', 'video'].includes(project.type);
  const catLabel = getCategoryLabel(project.category);
  const thumb = project.thumbnail || project.src;

  item.innerHTML = `
    ${isVideo ? `
      <div style="position:relative;min-height:200px;background:#12121f;display:flex;align-items:center;justify-content:center;">
        ${thumb ? `<img src="${thumb}" alt="${project.title}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;" loading="lazy"/>` : ''}
        <div class="play-icon" style="position:relative;z-index:2;"><i class="fas fa-play"></i></div>
      </div>
      <div class="video-badge"><i class="fas fa-film"></i> ${project.type}</div>
    ` : `
      <img src="${thumb}" alt="${project.title}" loading="lazy"/>
    `}
    <div class="gmi-overlay">
      <div class="gmi-cat">${catLabel}</div>
      <div class="gmi-title">${project.title}</div>
      <div class="gmi-actions">
        <button class="gmi-btn" title="View"><i class="fas fa-expand"></i></button>
      </div>
    </div>
  `;

  item.querySelector('.gmi-btn')?.addEventListener('click', () => openLightbox(idx));
  item.addEventListener('click', () => openLightbox(idx));
  return item;
}

/* ============================================================
   ALL GALLERY SECTION (compact masonry)
   ============================================================ */
function renderAllGallery() {
  const grid = document.getElementById('gallery-all-grid');
  if (!grid || !portfolioData?.projects?.length) return;

  grid.innerHTML = '';
  portfolioData.projects.forEach((project, idx) => {
    const item = document.createElement('div');
    item.className = 'gmi-item';
    const thumb = project.thumbnail || project.src;
    const isVideo = ['youtube','vimeo','video'].includes(project.type);

    item.innerHTML = `
      ${isVideo
        ? `<div style="background:#12121f;min-height:120px;display:flex;align-items:center;justify-content:center;position:relative;">
            ${thumb ? `<img src="${thumb}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;" loading="lazy"/>` : ''}
            <i class="fas fa-play" style="position:relative;z-index:2;color:var(--accent2);font-size:1.5rem;"></i>
           </div>`
        : `<img src="${thumb}" alt="${project.title}" loading="lazy"/>`
      }
    `;
    item.addEventListener('click', () => openLightboxAll(idx));
    grid.appendChild(item);
  });
}

function getCategoryLabel(catId) {
  if (!portfolioData?.categories) return catId;
  return portfolioData.categories.find(c => c.id === catId)?.label || catId;
}

function showGalleryEmpty() {
  document.getElementById('gallery-loading')?.style && (document.getElementById('gallery-loading').style.display = 'none');
  document.getElementById('gallery-empty')?.style && (document.getElementById('gallery-empty').style.display = 'block');
}

/* ============================================================
   LIGHTBOX
   ============================================================ */
function initLightbox() {
  const lb = document.getElementById('lightbox');
  if (!lb) return;

  document.getElementById('lb-close')?.addEventListener('click', closeLightbox);
  document.getElementById('lb-prev')?.addEventListener('click',  () => navigateLB(-1));
  document.getElementById('lb-next')?.addEventListener('click',  () => navigateLB(1));
  lb.addEventListener('click', e => { if (e.target === lb) closeLightbox(); });

  document.addEventListener('keydown', e => {
    if (!lb.classList.contains('open')) return;
    if (e.key === 'Escape')      closeLightbox();
    if (e.key === 'ArrowLeft')   navigateLB(-1);
    if (e.key === 'ArrowRight')  navigateLB(1);
  });
}

function openLightbox(idx) {
  currentLBIndex = idx;
  renderLBContent(filteredProjects);
  const lb = document.getElementById('lightbox');
  lb.classList.add('open');
  document.body.style.overflow = 'hidden';
  setTimeout(() => lb.classList.add('visible'), 10);
}

function openLightboxAll(idx) {
  filteredProjects = portfolioData.projects;
  openLightbox(idx);
}

function closeLightbox() {
  const lb = document.getElementById('lightbox');
  lb.classList.remove('visible');
  setTimeout(() => {
    lb.classList.remove('open');
    document.body.style.overflow = '';
    const content = document.getElementById('lb-content');
    if (content) {
      const vid = content.querySelector('video');
      if (vid) vid.pause();
      content.innerHTML = '';
    }
  }, 300);
}

function navigateLB(dir) {
  currentLBIndex = (currentLBIndex + dir + filteredProjects.length) % filteredProjects.length;
  renderLBContent(filteredProjects);
}

function renderLBContent(list) {
  const project = list[currentLBIndex];
  if (!project) return;

  document.getElementById('lb-title').textContent   = project.title || '';
  document.getElementById('lb-desc').textContent    = project.description || '';
  document.getElementById('lb-counter').textContent = `${currentLBIndex + 1} / ${list.length}`;

  const content = document.getElementById('lb-content');
  content.innerHTML = '';

  if (project.type === 'youtube' || project.type === 'vimeo') {
    const iframe = document.createElement('iframe');
    iframe.src = project.src + (project.src.includes('?') ? '&' : '?') + 'autoplay=1';
    iframe.allow = 'autoplay; fullscreen; picture-in-picture';
    iframe.allowFullscreen = true;
    content.appendChild(iframe);
  } else if (project.type === 'video') {
    const video = document.createElement('video');
    video.src = project.src;
    video.controls = true;
    video.autoplay = true;
    content.appendChild(video);
  } else {
    const img = document.createElement('img');
    img.src = project.src;
    img.alt = project.title;
    content.appendChild(img);
  }

  const prevBtn = document.getElementById('lb-prev');
  const nextBtn = document.getElementById('lb-next');
  if (prevBtn) prevBtn.style.display = list.length > 1 ? 'flex' : 'none';
  if (nextBtn) nextBtn.style.display = list.length > 1 ? 'flex' : 'none';
}

/* ============================================================
   CONTACT FORM
   ============================================================ */
function initContactForm() {
  const form = document.getElementById('contact-form');
  if (!form) return;

  // Direct WhatsApp Button (Launches native WhatsApp app directly on mobile)
  const waBtn = document.getElementById('btnSendWhatsApp');
  if (waBtn) {
    waBtn.addEventListener('click', () => {
      const name    = document.getElementById('cf-name')?.value.trim();
      const email   = document.getElementById('cf-email')?.value.trim();
      const service = document.getElementById('cf-service')?.value;
      const msg     = document.getElementById('cf-message')?.value.trim();

      const phoneText = document.getElementById('cd-phone')?.textContent || '+923392332272';
      const cleanPhone = phoneText.replace(/[^0-9]/g, '');

      let waMsg = `*New Portfolio Inquiry*\n`;
      if (name)    waMsg += `👤 *Name:* ${name}\n`;
      if (email)   waMsg += `📧 *Email:* ${email}\n`;
      if (service) waMsg += `🛠️ *Service:* ${service}\n`;
      if (msg)     waMsg += `💬 *Message:* ${msg}`;

      openDirectWhatsApp(cleanPhone, waMsg);
    });
  }

  // ----------------------------------------------------------------
  // SEND MESSAGE — Web3Forms (direct server-to-server, no client email needed)
  // ----------------------------------------------------------------
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const name    = document.getElementById('cf-name')?.value.trim();
    const email   = document.getElementById('cf-email')?.value.trim();
    const service = document.getElementById('cf-service')?.value;
    const msg     = document.getElementById('cf-message')?.value.trim();
    if (!name || !email || !msg) {
      showToast('\u26a0\ufe0f Apna naam, email aur message zaroor likhein!', 'error');
      return;
    }

    const submitBtn = document.getElementById('btnSendEmail');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Bheja ja raha hai...';
    }

    // --- Primary: Web3Forms (free, no client email app needed) ---
    // ACCESS KEY: Get yours free from https://web3forms.com (enter designcorner488@gmail.com)
    const WEB3FORMS_KEY = '006c9683-4571-4a5b-94ee-a8bd58cb0158'; // Web3Forms access key

    let sent = false;

    // Only attempt Web3Forms if key is configured
    if (WEB3FORMS_KEY && WEB3FORMS_KEY !== 'YOUR_WEB3FORMS_ACCESS_KEY') {
      try {
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), 8000);

        const res = await fetch('https://api.web3forms.com/submit', {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({
            access_key: WEB3FORMS_KEY,
            subject: `New Portfolio Inquiry: ${service || 'General'} — from ${name}`,
            from_name: name,
            email: email,
            name: name,
            service: service || 'General',
            message: msg,
            botcheck: ''
          })
        });
        clearTimeout(tid);

        const data = await res.json();
        if (data.success) {
          sent = true;
          showToast('\u2705 Message seedha aapki email par pahunch gaya!');
          const success = document.getElementById('formSuccess');
          if (success) {
            success.style.display = 'flex';
            success.innerHTML = '<i class="fas fa-check-circle"></i> Message successfully send ho gaya! Hum jaldi jawab denge.';
            setTimeout(() => success.style.display = 'none', 7000);
          }
          form.reset();
        } else {
          throw new Error(data.message || 'Web3Forms error');
        }
      } catch(err) {
        console.warn('Web3Forms attempt failed:', err);
      }
    }

    // --- Secondary: FormSubmit.co (backup) ---
    if (!sent) {
      try {
        const targetEmail = (document.getElementById('cd-email')?.textContent || 'designcorner488@gmail.com').trim();
        const controller2 = new AbortController();
        const tid2 = setTimeout(() => controller2.abort(), 6000);

        const res2 = await fetch(`https://formsubmit.co/ajax/${targetEmail}`, {
          method: 'POST',
          signal: controller2.signal,
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({
            _subject: `Portfolio Inquiry from ${name} (${service || 'General'})`,
            _captcha: 'false',
            _template: 'table',
            name, email,
            service: service || 'General',
            message: msg
          })
        });
        clearTimeout(tid2);

        if (res2.ok) {
          sent = true;
          showToast('\u2705 Message send ho gaya!');
          const success = document.getElementById('formSuccess');
          if (success) {
            success.style.display = 'flex';
            success.innerHTML = '<i class="fas fa-check-circle"></i> Message successfully send ho gaya!';
            setTimeout(() => success.style.display = 'none', 7000);
          }
          form.reset();
        } else {
          throw new Error('FormSubmit non-200');
        }
      } catch(err2) {
        console.warn('FormSubmit also failed, using Gmail Web Compose fallback:', err2);
      }
    }

    // --- Final Fallback: Gmail Web Compose (only if both APIs fail) ---
    if (!sent) {
      const targetEmail = (document.getElementById('cd-email')?.textContent || 'designcorner488@gmail.com').trim();
      const subject = encodeURIComponent(`Portfolio Inquiry: ${service || 'General'} from ${name}`);
      const body    = encodeURIComponent(`Name: ${name}\nEmail: ${email}\nService: ${service || 'Not specified'}\n\nMessage:\n${msg}`);
      const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(targetEmail)}&su=${subject}&body=${body}`;
      window.open(gmailUrl, '_blank');
      showToast('\u{1F4E7} Servers down hain — Gmail open ho raha hai. Message pehle se bhara hua hai, bas Send dabayein.');
    }

    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>Send Message</span><i class="fas fa-paper-plane"></i>';
    }
  });
}

/* ============================================================
   FOOTER YEAR
   ============================================================ */
function setFooterYear() {
  const el = document.getElementById('footer-year');
  if (el) el.textContent = new Date().getFullYear();
}



/* ============================================================
   EDIT MODE SYSTEM
   ============================================================ */



// EXPOSE ALL FUNCTIONS TO WINDOW SO ONCLICK ALWAYS WORKS
window.tryToggleEditMode = tryToggleEditMode;
window.triggerAddSoftware = function() {
  openSoftwareModal();
};
window.lockEditMode = function() {
  sessionStorage.removeItem('cms_session_auth');
  if (editMode) toggleEditMode();
  showToast('🔒 Edit Mode lock ho gaya!', 'error');
};
window.openSoftwareModal = openSoftwareModal;
window.closeSoftwareModal = closeSoftwareModal;
window.addNewSoftwareTag = addNewSoftwareTag;
window.saveAll = saveAll;
window.handleEditAuth = handleEditAuth;
window.closeEditAuthModal = closeEditAuthModal;


/* ============================================================
   NAVBAR PNG LOGO UPLOAD & MANAGEMENT
   ============================================================ */
function initLogoUpload() {
  const fileInput = document.getElementById('navLogoFileInput');
  const removeBtn = document.getElementById('btnLogoRemove');

  if (fileInput) {
    fileInput.addEventListener('change', function() {
      const file = this.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = e => {
        const dataUrl = e.target.result;
        setNavLogo(dataUrl);
        const d = getSavedData();
        d.logoImg = dataUrl;
        saveData(d);
        showToast('🎨 Logo update ho gaya!');
      };
      reader.readAsDataURL(file);
      this.value = '';
    });
  }

  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      setNavLogo(null);
      const d = getSavedData();
      delete d.logoImg;
      saveData(d);
      showToast('Logo remove ho gaya!', 'error');
    });
  }

  const savedLogo = getSavedData()?.logoImg;
  if (savedLogo) {
    setNavLogo(savedLogo);
  }
}

function setNavLogo(src) {
  const logoImg   = document.getElementById('navLogoImg');
  const removeBtn = document.getElementById('btnLogoRemove');
  if (src) {
    if (logoImg) {
      logoImg.src = src;
      logoImg.style.display = 'inline-block';
    }
    if (removeBtn) removeBtn.style.display = '';
  } else {
    if (logoImg) {
      logoImg.src = '';
      logoImg.style.display = 'none';
    }
    if (removeBtn) removeBtn.style.display = 'none';
  }
}

function initEditMode() {
  initLogoUpload();
  const btn = document.getElementById('editToggleBtn');
  const navBtn = document.getElementById('navEditBtn');
  if (btn) btn.addEventListener('click', tryToggleEditMode);
  if (navBtn) navBtn.addEventListener('click', tryToggleEditMode);
  document.getElementById('btnSave')?.addEventListener('click', saveAll);
  document.getElementById('btnReset')?.addEventListener('click', () => {
    if (confirm('⚠️ Sab local edits reset ho jayengi! Sure hain?')) {
      localStorage.removeItem('portfolio_edit_data');
      showToast('🔄 Reset! Reload ho raha hai...', 'error');
      setTimeout(() => location.reload(), 1200);
    }
  });

  // Manage software tags
  document.getElementById('btnManageSoftwares')?.addEventListener('click', openSoftwareModal);
  document.getElementById('orbitAddBtn')?.addEventListener('click', () => {
    const isAuth = sessionStorage.getItem('cms_session_auth') === 'true';
    if (isAuth) {
      openSoftwareModal();
    } else {
      openEditAuthModal(() => openSoftwareModal());
    }
  });
  document.getElementById('orbitPillTag')?.addEventListener('click', () => {
    const isAuth = sessionStorage.getItem('cms_session_auth') === 'true';
    if (isAuth) {
      openSoftwareModal();
    } else {
      openEditAuthModal(() => openSoftwareModal());
    }
  });
  document.getElementById('softwareModalClose')?.addEventListener('click', closeSoftwareModal);
  document.getElementById('softwareModalDone')?.addEventListener('click', () => {
    closeSoftwareModal();
    saveAll();
  });
  document.getElementById('btnAddNewSoftware')?.addEventListener('click', addNewSoftwareTag);
  document.getElementById('newSoftwareName')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addNewSoftwareTag(); }
  });
  document.getElementById('softwareModal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('softwareModal')) closeSoftwareModal();
  });

  // Lock button
  document.getElementById('btnLock')?.addEventListener('click', () => {
    sessionStorage.removeItem('cms_session_auth');
    if (editMode) toggleEditMode();
    showToast('🔒 Edit Mode lock ho gaya!', 'error');
  });

  // Password verification modal
  document.getElementById('editAuthClose')?.addEventListener('click', closeEditAuthModal);
  document.getElementById('editAuthCancel')?.addEventListener('click', closeEditAuthModal);
  document.getElementById('editAuthSubmit')?.addEventListener('click', handleEditAuth);
  document.getElementById('editAuthPass')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleEditAuth();
  });
  document.getElementById('editAuthModal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('editAuthModal')) closeEditAuthModal();
  });

  // Profile photo upload
  document.getElementById('fileInputPhoto')?.addEventListener('change', function() {
    const file = this.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      const img = document.getElementById('profilePhoto');
      const ph  = document.getElementById('avatarPlaceholder');
      if (img) { img.src = e.target.result; img.style.display = 'block'; }
      if (ph)  ph.style.display = 'none';
      const data = getSavedData();
      data.profilePhoto = e.target.result;
      saveData(data);
      showToast('📸 Profile photo update ho gayi!');
    };
    reader.readAsDataURL(file);
    this.value = '';
  });

  // Social modal buttons
  document.getElementById('socialModalClose')?.addEventListener('click',  () => document.getElementById('socialModal').classList.remove('open'));
  document.getElementById('socialModalCancel')?.addEventListener('click', () => document.getElementById('socialModal').classList.remove('open'));
  document.getElementById('socialModal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('socialModal')) document.getElementById('socialModal').classList.remove('open');
  });
  document.getElementById('socialModalSave')?.addEventListener('click', () => {
    let inputVal = document.getElementById('socialUrlInput')?.value.trim();
    if (!inputVal) return;

    let finalUrl = inputVal;
    if (currentSocialPlatform === 'whatsapp') {
      let clean = inputVal.replace(/[^0-9]/g, '');
      if (clean.startsWith('03')) clean = '92' + clean.slice(1);
      if (!inputVal.startsWith('http')) {
        finalUrl = `https://web.whatsapp.com/send?phone=${clean}`;
      }
    } else if (currentSocialPlatform === 'instagram') {
      if (!inputVal.startsWith('http')) {
        const username = inputVal.replace(/^@/, '');
        finalUrl = `https://instagram.com/${username}`;
      }
    } else if (currentSocialPlatform === 'behance') {
      if (!inputVal.startsWith('http')) {
        finalUrl = `https://behance.net/${inputVal}`;
      }
    } else if (currentSocialPlatform === 'linkedin') {
      if (!inputVal.startsWith('http')) {
        finalUrl = `https://linkedin.com/in/${inputVal}`;
      }
    } else if (currentSocialPlatform === 'youtube') {
      if (!inputVal.startsWith('http')) {
        finalUrl = inputVal.startsWith('@') ? `https://youtube.com/${inputVal}` : `https://youtube.com/@${inputVal}`;
      }
    }

    document.querySelectorAll(`[data-platform="${currentSocialPlatform}"]`).forEach(el => {
      el.href = finalUrl;
      el.target = '_blank';
      el.rel = 'noopener noreferrer';
    });

    const data = getSavedData();
    data.socialLinks = data.socialLinks || {};
    data.socialLinks[currentSocialPlatform] = finalUrl;
    saveData(data);

    document.getElementById('socialModal')?.classList.remove('open');
    showToast(`🔗 ${currentSocialPlatform.toUpperCase()} connect ho gaya!`);
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.key.toLowerCase() === 'e') { e.preventDefault(); tryToggleEditMode(); }
    if (e.ctrlKey && e.key.toLowerCase() === 's' && editMode) { e.preventDefault(); saveAll(); }
  });

  loadSavedEdits();
}

let lastToggleTime = 0;
function tryToggleEditMode() {
  const now = Date.now();
  if (now - lastToggleTime < 300) return;
  lastToggleTime = now;

  if (editMode) {
    toggleEditMode();
    return;
  }
  const isAuth = sessionStorage.getItem('cms_session_auth') === 'true';
  if (isAuth) {
    toggleEditMode();
  } else {
    openEditAuthModal();
  }
}

function openEditAuthModal(callback = null) {
  authSuccessCallback = callback;
  const modal = document.getElementById('editAuthModal');
  if (modal) {
    modal.style.display = 'flex';
    modal.style.opacity = '1';
    modal.style.visibility = 'visible';
    modal.style.zIndex = '999999';
    modal.classList.add('open');
    const passInput = document.getElementById('editAuthPass');
    const err = document.getElementById('editAuthError');
    if (err) err.style.display = 'none';
    if (passInput) {
      passInput.value = '';
      setTimeout(() => passInput.focus(), 100);
    }
  } else {
    const entered = prompt('Enter Admin Password:');
    if (entered === (localStorage.getItem('cms_admin_password') || 'admin123')) {
      sessionStorage.setItem('cms_session_auth', 'true');
      if (typeof authSuccessCallback === 'function') authSuccessCallback();
      else toggleEditMode();
    } else if (entered) {
      alert('Incorrect password!');
    }
  }
}

function closeEditAuthModal() {
  const modal = document.getElementById('editAuthModal');
  if (modal) {
    modal.style.display = 'none';
    modal.style.opacity = '0';
    modal.style.visibility = 'hidden';
    modal.classList.remove('open');
  }
  authSuccessCallback = null;
}

let lastAuthTime = 0;
function handleEditAuth() {
  const now = Date.now();
  if (now - lastAuthTime < 300) return;
  lastAuthTime = now;
  const passInput = document.getElementById('editAuthPass');
  const entered = passInput?.value || '';
  const savedPass = localStorage.getItem('cms_admin_password') || 'admin123';
  const err = document.getElementById('editAuthError');

  if (entered === savedPass) {
    sessionStorage.setItem('cms_session_auth', 'true');
    closeEditAuthModal();
    if (typeof authSuccessCallback === 'function') {
      const cb = authSuccessCallback;
      authSuccessCallback = null;
      cb();
    } else {
      toggleEditMode();
    }
  } else {
    if (err) {
      err.style.display = 'block';
      err.textContent = '❌ Incorrect password! Access denied.';
    }
    passInput?.focus();
  }
}

function toggleEditMode() {
  editMode = !editMode;
  const btn   = document.getElementById('editToggleBtn');
  const icon  = document.getElementById('editIcon');
  const label = document.getElementById('editLabel');

  document.body.classList.toggle('edit-mode', editMode);
  document.getElementById('editToolbar')?.classList.toggle('active', editMode);
  btn?.classList.toggle('editing', editMode);
  document.getElementById('navbar')?.classList.toggle('edit-pushed', editMode);
  // Show / Hide Sci-Fi edit actions
  const scifiActions = document.getElementById('scifiEditActions');
  if (scifiActions) scifiActions.style.display = editMode ? 'flex' : 'none';
  // In Edit Mode, pause 5s timer and show Face A so user can see photo and edit easily
  if (editMode) {
    if (typeof flipPortal === 'function') flipPortal(false);
    if (scifiTimer) clearInterval(scifiTimer);
  } else {
    if (typeof startScifiTimer === 'function') startScifiTimer();
    if (typeof startSkillAutoTimer === 'function') startSkillAutoTimer();
  }
  if (icon)  icon.className   = editMode ? 'fas fa-xmark' : 'fas fa-pen-to-square';
  if (label) label.textContent = editMode ? 'Exit Edit' : 'Edit Mode';

  if (editMode) {
    document.querySelectorAll('.editable').forEach(el => {
      el.setAttribute('contenteditable', 'true');
      el.setAttribute('spellcheck', 'false');
      // Auto-save on blur
      if (!el._hasSaveListener && el.dataset.key) {
        el._hasSaveListener = true;
        el.addEventListener('blur', () => {
          const d = getSavedData();
          d.text = d.text || {};
          d.text[el.dataset.key] = el.innerHTML;
          saveData(d);
        });
      }
    });
    // GLB viewer handled separately
    // Social links — click to set URL
    document.querySelectorAll('.social-link').forEach(link => {
      link.onclick = e => {
        if (!editMode) return;
        e.preventDefault(); e.stopPropagation();
        openSocialModal(link.dataset.platform, link);
      };
    });
    showToast('✏️ Edit Mode ON — text par click kar ke edit karein!');
  } else {
    document.querySelectorAll('.editable').forEach(el => el.removeAttribute('contenteditable'));
    showToast('✅ View Mode — changes browser mein save hain!');
  }
  renderOrbitTags();
}

function renderOrbitTags() {
  renderDynamicOrbitSystem();
  const container = document.getElementById('floatingTags');
  if (!container) return;
  container.innerHTML = '';
  currentSoftwareTags.forEach((name, i) => {
    const span = document.createElement('span');
    span.className = `tag t${(i % 12) + 1}${editMode ? ' editable' : ''}`;
    span.textContent = name;
    if (editMode) {
      span.setAttribute('contenteditable', 'true');
      span.setAttribute('spellcheck', 'false');
      span.title = 'Click to edit text directly';
      span.addEventListener('input', () => {
        currentSoftwareTags[i] = span.textContent.trim();
        const d = getSavedData();
        d.softwareTags = currentSoftwareTags;
        saveData(d);
      });
    } else {
      span.title = 'Click to manage softwares';
      span.style.cursor = 'pointer';
      span.addEventListener('click', () => {
        const isAuth = sessionStorage.getItem('cms_session_auth') === 'true';
        if (isAuth) {
          openSoftwareModal();
        } else {
          openEditAuthModal(() => openSoftwareModal());
        }
      });
    }
    container.appendChild(span);
  });
}
// No inline floating pill — 'Manage Software Tags' button is below the orbit card

function openSoftwareModal() {
  renderSoftwareModalList();
  const modal = document.getElementById('softwareModal');
  if (modal) {
    modal.style.display = 'flex';
    modal.style.opacity = '1';
    modal.style.visibility = 'visible';
    modal.style.zIndex = '999999';
    modal.classList.add('open');
    setTimeout(() => document.getElementById('newSoftwareName')?.focus(), 100);
  } else {
    const name = prompt('Enter Software Name (e.g. AutoCAD, 3ds Max):');
    if (name) {
      currentSoftwareTags.push(name.trim());
      renderOrbitTags();
      const d = getSavedData();
      d.softwareTags = currentSoftwareTags;
      saveData(d);
    }
  }
}

function closeSoftwareModal() {
  const modal = document.getElementById('softwareModal');
  if (modal) {
    modal.style.display = 'none';
    modal.style.opacity = '0';
    modal.style.visibility = 'hidden';
    modal.classList.remove('open');
  }
}

function renderSoftwareModalList() {
  const list = document.getElementById('softwareTagsList');
  if (!list) return;
  list.innerHTML = '';
  if (!currentSoftwareTags.length) {
    list.innerHTML = '<span style="color:var(--text-muted);font-size:0.8rem;padding:0.4rem;">Koi software tag nahi hai. Neeche se add karein.</span>';
    return;
  }
  currentSoftwareTags.forEach((tag, idx) => {
    const chip = document.createElement('div');
    chip.className = 'modal-tag-chip';
    chip.innerHTML = `
      <span>${tag}</span>
      <button type="button" class="chip-del-btn" title="Delete"><i class="fas fa-xmark"></i></button>
    `;
    chip.querySelector('.chip-del-btn').addEventListener('click', () => {
      currentSoftwareTags.splice(idx, 1);
      renderSoftwareModalList();
      renderOrbitTags();
      const d = getSavedData();
      d.softwareTags = currentSoftwareTags;
      saveData(d);
      showToast('🗑️ Tag remove ho gaya!');
    });
    list.appendChild(chip);
  });
}

function addNewSoftwareTag() {
  const input = document.getElementById('newSoftwareName');
  const val = input?.value.trim();
  if (!val) return;
  if (currentSoftwareTags.length >= 12) {
    showToast('⚠️ Maximum 12 software tags rakh sakte hain', 'error');
    return;
  }
  currentSoftwareTags.push(val);
  input.value = '';
  renderSoftwareModalList();
  renderOrbitTags();
  const d = getSavedData();
  d.softwareTags = currentSoftwareTags;
  saveData(d);
  showToast(`✨ "${val}" circle mein add ho gaya!`);
}

function openSocialModal(platform, el) {
  currentSocialPlatform = platform;
  const data = getSavedData();
  const label = document.getElementById('socialModalLabel');
  const input = document.getElementById('socialUrlInput');
  const modal = document.getElementById('socialModal');

  if (label) {
    if (platform === 'whatsapp') label.textContent = 'WhatsApp Number ya Link enter karein:';
    else label.textContent = (platform ? platform.charAt(0).toUpperCase() + platform.slice(1) : 'Social') + ' username ya link:';
  }

  if (input) {
    const existing = (data.socialLinks && data.socialLinks[platform]) || (el?.getAttribute('href') !== '#' ? el?.getAttribute('href') : '') || '';
    input.value = existing;
    if (platform === 'whatsapp') {
      input.placeholder = 'e.g. 03392332272 ya 923392332272';
    } else if (platform === 'instagram') {
      input.placeholder = 'e.g. @yourusername ya direct link';
    } else {
      input.placeholder = `e.g. yourusername ya https://${platform}.com/...`;
    }
    setTimeout(() => input.focus(), 100);
  }

  if (modal) {
    modal.style.display = 'flex';
    modal.style.opacity = '1';
    modal.style.visibility = 'visible';
    modal.classList.add('open');
  }
}

async function saveAll() {
  const saveBtn = document.getElementById('btnSave');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
  }
  const data = getSavedData();
  data.text = data.text || {};
  document.querySelectorAll('.editable[data-key]').forEach(el => {
    data.text[el.dataset.key] = el.innerHTML;
  });
  const img = document.getElementById('profilePhoto');
  if (img && img.style.display !== 'none' && img.src && img.src.startsWith('data:')) {
    data.profilePhoto = img.src;
  }
  data.softwareTags = currentSoftwareTags;
  saveData(data);

  // Sync to GitHub if token exists in browser
  const token = localStorage.getItem('cms_gh_token');
  if (token && portfolioData) {
    try {
      showToast('☁️ GitHub par publish ho raha hai...', 'success');
      const fullPayload = buildPublishPayload();
      portfolioData = fullPayload;

      const fileRes = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/portfolio.json`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      let sha = null;
      if (fileRes.ok) {
        const fileJson = await fileRes.json();
        sha = fileJson.sha;
      }

      const jsonString = JSON.stringify(fullPayload, null, 2);
      const base64Json = btoa(unescape(encodeURIComponent(jsonString)));

      const putRes = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/portfolio.json`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: 'Update portfolio directly from website edit mode',
          content: base64Json,
          sha: sha,
          branch: BRANCH
        })
      });

      if (putRes.ok) {
        showToast('🚀 Live website update ho gayi aur GitHub par save ho gayi!');
      } else {
        showToast('💾 Changes browser mein save ho gaye!');
      }
    } catch (e) {
      console.warn(e);
      showToast('💾 Changes browser mein save ho gaye!');
    }
  } else {
    showToast('💾 Tamam changes browser mein save ho gaye!');
  }

  if (saveBtn) {
    saveBtn.disabled = false;
    saveBtn.innerHTML = '<i class="fas fa-floppy-disk"></i> Save';
  }
}

function getSavedData() {
  try { return JSON.parse(localStorage.getItem('portfolio_edit_data') || '{}'); } catch { return {}; }
}
function saveData(data) {
  try {
    localStorage.setItem('portfolio_edit_data', JSON.stringify(data));
  } catch {
    const slim = { text: data.text, socialLinks: data.socialLinks };
    try { localStorage.setItem('portfolio_edit_data', JSON.stringify(slim)); } catch {}
    showToast('⚠️ Image size zyada hai — text save ho gaya', 'error');
  }
}

function loadSavedEdits() {
  // 1. Published overrides from portfolio.json (for visitors)
  if (portfolioData && portfolioData._textOverrides) {
    Object.entries(portfolioData._textOverrides).forEach(([key, val]) => {
      const el = document.querySelector(`[data-key="${key}"]`);
      if (el && val) el.innerHTML = val;
    });
  }

  // 2. Local browser edits (for owner)
  const data = getSavedData();
  if (data.logoImg) setNavLogo(data.logoImg);
  if (data.text) {
    Object.entries(data.text).forEach(([key, val]) => {
      const el = document.querySelector(`[data-key="${key}"]`);
      if (el) el.innerHTML = val;
    });
  }
  if (data.profilePhoto) {
    const img = document.getElementById('profilePhoto');
    const ph  = document.getElementById('avatarPlaceholder');
    if (img) { img.src = data.profilePhoto; img.style.display = 'block'; }
    if (ph)  ph.style.display = 'none';
  }
  // Sci-Fi Avatar in Dynamic Circle
  const scifiImg = document.getElementById('scifiAvatarImg');
  if (scifiImg) {
    const scifiSrc = data.scifiAvatar || portfolioData?.settings?.scifiAvatar;
    if (scifiSrc) scifiImg.src = scifiSrc;
  }
  if (typeof renderAddons === 'function') renderAddons();
  if (data.socialLinks) {
    Object.entries(data.socialLinks).forEach(([platform, url]) => {
      document.querySelectorAll(`[data-platform="${platform}"]`).forEach(el => {
        el.href = url;
        el.target = '_blank';
        el.rel = 'noopener noreferrer';
      });
    });
  } else {
    // Default fallback for WhatsApp
    document.querySelectorAll('[data-platform="whatsapp"]').forEach(el => {
      el.href = 'https://wa.me/923392332272';
      el.target = '_blank';
      el.rel = 'noopener noreferrer';
    });
  }
  if (data.softwareTags && Array.isArray(data.softwareTags) && data.softwareTags.length) {
    currentSoftwareTags = data.softwareTags;
  }
  renderOrbitTags();
}

function showToast(msg, type = 'success') {
  const toast    = document.getElementById('toast');
  const toastMsg = document.getElementById('toastMsg');
  if (!toast || !toastMsg) return;
  toastMsg.textContent = msg;
  toast.style.borderColor = type === 'error' ? 'rgba(239,68,68,.4)' : 'rgba(16,185,129,.4)';
  toast.style.color       = type === 'error' ? '#ef4444' : 'var(--green)';
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

console.log('%c✏️ Edit Mode Loaded', 'color:#a855f7;font-size:1.1rem;font-weight:bold;');
console.log('%cCtrl+E = Toggle Edit | Ctrl+S = Save', 'color:#06b6d4;');




/* ============================================================
   DYNAMIC ORBIT SYSTEM — 1 Rotating Planet per Software Tag
   ============================================================ */
const SOFTWARE_CONFIGS = {
  'blender':      { icon: 'fas fa-cube', grad: 'linear-gradient(135deg,#f7931e,#f59e0b)' },
  'revit':        { icon: 'fas fa-drafting-compass', grad: 'linear-gradient(135deg,#0696d7,#06b6d4)' },
  'd5':           { icon: 'fas fa-photo-film', grad: 'linear-gradient(135deg,#10b981,#059669)' },
  'd5 render':    { icon: 'fas fa-photo-film', grad: 'linear-gradient(135deg,#10b981,#059669)' },
  'animation':    { icon: 'fas fa-film', grad: 'linear-gradient(135deg,#7c3aed,#ec4899)' },
  '3d animation': { icon: 'fas fa-film', grad: 'linear-gradient(135deg,#7c3aed,#ec4899)' },
  'lumion':       { icon: 'fas fa-sun', grad: 'linear-gradient(135deg,#f59e0b,#ef4444)' },
  'rhino':        { icon: 'fas fa-draw-polygon', grad: 'linear-gradient(135deg,#ec4899,#8b5cf6)' },
  'vectorworks':  { icon: 'fas fa-pen-ruler', grad: 'linear-gradient(135deg,#06b6d4,#3b82f6)' },
  'bim':          { icon: 'fas fa-cubes', grad: 'linear-gradient(135deg,#10b981,#06b6d4)' },
  'bim modelling':{ icon: 'fas fa-cubes', grad: 'linear-gradient(135deg,#10b981,#06b6d4)' },
  'autocad':      { icon: 'fas fa-compass-drafting', grad: 'linear-gradient(135deg,#ef4444,#f97316)' },
  '3ds max':      { icon: 'fas fa-gem', grad: 'linear-gradient(135deg,#6366f1,#a855f7)' },
  'sketchup':     { icon: 'fas fa-house', grad: 'linear-gradient(135deg,#ef4444,#3b82f6)' },
  'vray':         { icon: 'fas fa-wand-magic-sparkles', grad: 'linear-gradient(135deg,#3b82f6,#10b981)' },
  'photoshop':    { icon: 'fas fa-palette', grad: 'linear-gradient(135deg,#3b82f6,#06b6d4)' }
};

function getSoftwareConfig(name) {
  const key = (name || '').toLowerCase().trim();
  for (const [k, v] of Object.entries(SOFTWARE_CONFIGS)) {
    if (key.includes(k)) return v;
  }
  const defaultColors = [
    'linear-gradient(135deg,#f7931e,#f59e0b)',
    'linear-gradient(135deg,#0696d7,#06b6d4)',
    'linear-gradient(135deg,#10b981,#059669)',
    'linear-gradient(135deg,#7c3aed,#ec4899)',
    'linear-gradient(135deg,#f59e0b,#ef4444)',
    'linear-gradient(135deg,#ec4899,#8b5cf6)',
    'linear-gradient(135deg,#06b6d4,#3b82f6)',
    'linear-gradient(135deg,#10b981,#06b6d4)'
  ];
  let sum = 0;
  for (let j = 0; j < (name || '').length; j++) sum += name.charCodeAt(j);
  return { icon: 'fas fa-circle-nodes', grad: defaultColors[sum % defaultColors.length] };
}

function renderDynamicOrbitSystem() {
  const container = document.getElementById('orbitContainer');
  if (!container) return;
  container.innerHTML = '';
  const total = currentSoftwareTags.length;
  if (!total) return;

  const trackCount = Math.min(Math.max(3, Math.ceil(total / 2)), 5);
  const minD = 175;
  const maxD = 390;
  const step = (maxD - minD) / Math.max(trackCount - 1, 1);

  currentSoftwareTags.forEach((name, i) => {
    const trackIndex = i % trackCount;
    const diameter = Math.round(minD + trackIndex * step);
    const startAngle = Math.round((i * (360 / total)) % 360);
    const speed = 9 + (trackIndex * 3.5);

    const ring = document.createElement('div');
    ring.className = 'orbit-ring dynamic-ring';
    ring.style.width = diameter + 'px';
    ring.style.height = diameter + 'px';
    ring.style.setProperty('--start-angle', startAngle + 'deg');
    ring.style.animation = `dynamicOrbit ${speed}s linear infinite`;

    const conf = getSoftwareConfig(name);
    const planet = document.createElement('div');
    planet.className = 'planet';
    planet.style.background = conf.grad;
    planet.style.setProperty('--start-angle', startAngle + 'deg');
    planet.style.animation = `dynamicCounterRotate ${speed}s linear infinite`;
    planet.title = `${name} — Click to manage`;
    planet.innerHTML = `<i class="${conf.icon}"></i>`;
    planet.addEventListener('click', (e) => {
      e.stopPropagation();
      openSoftwareModal();
    });

    ring.appendChild(planet);
    container.appendChild(ring);
  });
}

/* ============================================================
   INDEXEDDB MEDIA STORE — 3D Models (GLB) & Animations (MP4)
   ============================================================ */
const IDB_NAME = 'PortfolioMediaDB_v2';
const IDB_STORE = 'models_animations';

function openMediaDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject('IndexedDB not supported');
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE, { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbSaveItem(item) {
  try {
    const db = await openMediaDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).add(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch(e) { console.warn('IDB Save error:', e); }
}

async function dbGetAllItems() {
  try {
    const db = await openMediaDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch(e) { console.warn('IDB Get error:', e); return []; }
}

async function dbDeleteItem(id) {
  try {
    const db = await openMediaDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch(e) { console.warn('IDB Delete error:', e); }
}

/* ============================================================
   3D GLB & VIDEO ANIMATION VIEWER (Scroll-driven, up to 30)
   ============================================================ */
let mediaList = [];
let mediaIndex = 0;
const MEDIA_MAX = 30;

// Default 3D model fallback so it never renders blank
const DEFAULT_SAMPLE_MODEL = {
  id: 'sample-default',
  name: 'Architectural 3D Model',
  type: 'glb',
  url: 'https://modelviewer.dev/shared-assets/models/Astronaut.glb'
};


async function dbSaveAllOrdered(items) {
  try {
    const db = await openMediaDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      store.clear();
      items.forEach((it, idx) => {
        if (it.id === 'sample-default') return;
        store.add({
          name: it.name,
          type: it.type,
          blob: it.rawBlob || it.blob,
          orderIndex: idx
        });
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch(e) { console.warn('IDB Save Ordered error:', e); }
}

async function setAsFirstMedia() {
  if (!mediaList.length || mediaIndex === 0) return;
  const item = mediaList.splice(mediaIndex, 1)[0];
  mediaList.unshift(item);
  await dbSaveAllOrdered(mediaList);
  showToast(`⭐ "${item.name}" No. 1 Display set ho gaya!`);
  setMediaIndex(0);
}

function openReorderModal() {
  const modal = document.getElementById('glbReorderModal');
  if (!modal) return;
  renderReorderList();
  modal.style.display = 'flex';
  modal.style.opacity = '1';
  modal.style.visibility = 'visible';
  modal.classList.add('open');
}

function closeReorderModal() {
  const modal = document.getElementById('glbReorderModal');
  if (modal) {
    modal.style.display = 'none';
    modal.style.opacity = '0';
    modal.style.visibility = 'hidden';
    modal.classList.remove('open');
  }
}

window.openReorderModal = openReorderModal;
window.closeReorderModal = closeReorderModal;

function renderReorderList() {
  const list = document.getElementById('reorderList');
  if (!list) return;
  list.innerHTML = '';

  if (!mediaList.length) {
    list.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:1rem;">Koi uploaded model nahi hai.</p>';
    return;
  }

  mediaList.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = `reorder-item${idx === 0 ? ' first-item' : ''}${idx === mediaIndex ? ' active-item' : ''}`;

    const iconClass = item.type === 'video' ? 'fas fa-video' : 'fas fa-cube';
    const badgeText = idx === 0 ? '★ 1' : `#${idx + 1}`;

    row.innerHTML = `
      <span class="reorder-badge">${badgeText}</span>
      <div class="reorder-info">
        <i class="${iconClass}"></i>
        <span class="reorder-name">${item.name || 'Asset'} ${idx === 0 ? '<strong style="color:var(--gold);font-size:0.75rem;">(Main Display)</strong>' : ''}</span>
      </div>
      <div class="reorder-btns">
        <button type="button" class="reorder-btn" title="Move Up" ${idx === 0 ? 'disabled' : ''} onclick="moveMediaPosition(${idx}, ${idx - 1})"><i class="fas fa-arrow-up"></i></button>
        <button type="button" class="reorder-btn" title="Move Down" ${idx === mediaList.length - 1 ? 'disabled' : ''} onclick="moveMediaPosition(${idx}, ${idx + 1})"><i class="fas fa-arrow-down"></i></button>
        <button type="button" class="reorder-btn star-btn" title="Set as #1 First" ${idx === 0 ? 'disabled' : ''} onclick="moveMediaToTop(${idx})"><i class="fas fa-star"></i></button>
      </div>
    `;
    list.appendChild(row);
  });
}

async function moveMediaPosition(fromIdx, toIdx) {
  if (toIdx < 0 || toIdx >= mediaList.length) return;
  const item = mediaList.splice(fromIdx, 1)[0];
  mediaList.splice(toIdx, 0, item);
  await dbSaveAllOrdered(mediaList);
  renderReorderList();
  renderMediaDots();
  setMediaIndex(toIdx);
}

async function moveMediaToTop(fromIdx) {
  if (fromIdx <= 0 || fromIdx >= mediaList.length) return;
  const item = mediaList.splice(fromIdx, 1)[0];
  mediaList.unshift(item);
  await dbSaveAllOrdered(mediaList);
  renderReorderList();
  renderMediaDots();
  setMediaIndex(0);
}

window.moveMediaPosition = moveMediaPosition;
window.moveMediaToTop = moveMediaToTop;


async function initGLBViewer() {
  const fileInput     = document.getElementById('glbFileInput');
  const fileInputMore = document.getElementById('glbFileInputMore');
  const prevBtn       = document.getElementById('glbPrevBtn');
  const nextBtn       = document.getElementById('glbNextBtn');
  const delBtn        = document.getElementById('glbDelBtn');
  const setFirstBtn   = document.getElementById('glbSetFirstBtn');
  const reorderBtn    = document.getElementById('glbReorderBtn');

  if (fileInput)     fileInput.addEventListener('change',     e => handleUploadFiles(e.target.files));
  if (fileInputMore) fileInputMore.addEventListener('change', e => handleUploadFiles(e.target.files));
  if (prevBtn)       prevBtn.addEventListener('click', () => setMediaIndex(mediaIndex - 1));
  if (nextBtn)       nextBtn.addEventListener('click', () => setMediaIndex(mediaIndex + 1));
  if (delBtn)        delBtn.addEventListener('click', deleteCurrentMedia);
  if (setFirstBtn)   setFirstBtn.addEventListener('click', setAsFirstMedia);
  if (reorderBtn)    reorderBtn.addEventListener('click', openReorderModal);

  // Mouse wheel scroll to switch models/animations
  const wrap = document.getElementById('glbViewerWrap');
  if (wrap) {
    let scrollCoolDown = 0;
    wrap.addEventListener('wheel', e => {
      if (mediaList.length < 2) return;
      e.preventDefault();
      const now = Date.now();
      if (now - scrollCoolDown < 350) return;
      scrollCoolDown = now;
      if (e.deltaY > 0) setMediaIndex(mediaIndex + 1);
      else              setMediaIndex(mediaIndex - 1);
    }, { passive: false });
  }

  // Touch swipe support
  let touchStartY = 0;
  if (wrap) {
    wrap.addEventListener('touchstart', e => { touchStartY = e.touches[0].clientY; }, { passive: true });
    wrap.addEventListener('touchend',   e => {
      const dy = touchStartY - e.changedTouches[0].clientY;
      if (Math.abs(dy) > 40) {
        if (dy > 0) setMediaIndex(mediaIndex + 1);
        else        setMediaIndex(mediaIndex - 1);
      }
    });
  }

  await loadSavedMedia();
}

async function handleUploadFiles(files) {
  if (!files || !files.length) return;
  const remaining = MEDIA_MAX - mediaList.length;
  const toProcess = Math.min(files.length, remaining);
  if (toProcess < files.length) {
    showToast(`⚠️ Max ${MEDIA_MAX} models/animations allow hain!`, 'error');
  }

  let successCount = 0;
  for (let i = 0; i < toProcess; i++) {
    const file = files[i];
    const isModel = file.name.match(/\.(glb|gltf)$/i);
    const isVideo = file.name.match(/\.(mp4|webm)$/i);
    if (!isModel && !isVideo) continue;

    const item = {
      name: file.name.replace(/\.[^.]+$/, ''),
      type: isModel ? 'glb' : 'video',
      blob: file,
      rawBlob: file
    };

    await dbSaveItem(item);
    successCount++;
  }

  if (successCount > 0) {
    showToast(`🎉 ${successCount} item(s) successfully save ho gaye!`);
    await loadSavedMedia();
    setMediaIndex(mediaList.length - 1);
  }
}

async function loadSavedMedia() {
  mediaList = [];

  // 1. Owner browser: load from IndexedDB
  try {
    const fromDB = await dbGetAllItems();
    if (fromDB && fromDB.length > 0) {
      fromDB.forEach(item => {
        mediaList.push({
          id:      item.id,
          name:    item.name,
          type:    item.type,
          url:     URL.createObjectURL(item.blob),
          rawBlob: item.blob
        });
      });
    }
  } catch(e) { console.warn('IDB load error:', e); }

  // 2. Visitor browser (or if IndexedDB is empty): load from published portfolio.json
  if (!mediaList.length) {
    if (!portfolioData || !portfolioData._media) {
      try {
        const res = await fetch('portfolio.json?nc=' + Date.now());
        if (res.ok) portfolioData = await res.json();
      } catch(e) {
        try {
          const res = await fetch(DATA_URL);
          if (res.ok) portfolioData = await res.json();
        } catch(err) {}
      }
    }

    if (portfolioData && portfolioData._media && portfolioData._media.length > 0) {
      portfolioData._media.forEach(item => {
        mediaList.push({
          id:   item.name,
          name: item.displayName || item.name,
          type: item.type,
          url:  item.url
        });
      });
    }
  }

  // 3. Fallback only if absolutely nothing exists
  if (!mediaList.length) {
    mediaList.push(DEFAULT_SAMPLE_MODEL);
  }

  showMediaUI();
  setMediaIndex(0);
}

function showMediaUI() {
  const placeholder = document.getElementById('glbPlaceholder');
  const container   = document.getElementById('glbViewerContainer');
  if (placeholder) placeholder.style.display = 'none';
  if (container)   container.style.display   = 'block';
  renderMediaDots();
}

function setMediaIndex(idx) {
  if (!mediaList.length) return;
  mediaIndex = ((idx % mediaList.length) + mediaList.length) % mediaList.length;
  const current = mediaList[mediaIndex];

  const mv  = document.getElementById('mainModelViewer');
  const vid = document.getElementById('mainVideoViewer');
  const counter = document.getElementById('glbCounter');
  const name    = document.getElementById('glbModelName');
  const prevBtn = document.getElementById('glbPrevBtn');
  const nextBtn = document.getElementById('glbNextBtn');

  if (counter) counter.textContent = `${mediaIndex + 1} / ${mediaList.length}`;
  if (name)    name.textContent    = current.name || '3D Asset';

  if (current.type === 'video') {
    if (mv) mv.style.display = 'none';
    if (vid) {
      vid.style.display = 'block';
      vid.src = current.url;
      vid.play().catch(() => {});
    }
  } else {
    // 3D Model GLB
    if (vid) {
      vid.pause();
      vid.style.display = 'none';
    }
    if (mv) {
      mv.style.display = 'block';
      mv.setAttribute('src', current.url);
      mv.removeAttribute('auto-rotate');
      setTimeout(() => mv.setAttribute('auto-rotate', ''), 100);
    }
  }

  if (prevBtn) prevBtn.disabled = mediaList.length <= 1;
  if (nextBtn) nextBtn.disabled = mediaList.length <= 1;
  renderMediaDots();
}

async function deleteCurrentMedia() {
  if (!mediaList.length) return;
  const current = mediaList[mediaIndex];
  if (current.id === 'sample-default') {
    showToast('Yeh default sample model hai! Apna model upload karein.', 'error');
    return;
  }
  if (!confirm(`Kya aap "${current.name}" ko delete karna chahte hain?`)) return;

  await dbDeleteItem(current.id);
  showToast(`🗑️ "${current.name}" delete ho gaya!`);
  await loadSavedMedia();
}

function renderMediaDots() {
  let dotsWrap = document.getElementById('glbDots');
  if (!dotsWrap) {
    dotsWrap = document.createElement('div');
    dotsWrap.className = 'glb-dots';
    dotsWrap.id = 'glbDots';
    const wrap = document.getElementById('glbViewerWrap');
    if (wrap) wrap.appendChild(dotsWrap);
  }
  dotsWrap.innerHTML = '';
  if (mediaList.length <= 1) return;
  mediaList.forEach((m, i) => {
    const dot = document.createElement('div');
    dot.className = 'glb-dot' + (i === mediaIndex ? ' active' : '');
    dot.title = `${m.name} (${m.type.toUpperCase()})`;
    dot.addEventListener('click', () => setMediaIndex(i));
    dotsWrap.appendChild(dot);
  });
}


/* ============================================================
   BOOT PORTFOLIO (EXECUTES AFTER ALL DEFINITIONS)
   ============================================================ */

/* ============================================================
   SCI-FI CINEMATIC DYNAMIC CIRCLE PORTAL (5s ROTATION)
   ============================================================ */
let scifiTimer = null;
let scifiFlipped = false;

function flipPortal(forceState) {
  const card = document.getElementById('scifiFlipCard');
  if (!card) return;
  if (typeof forceState === 'boolean') {
    scifiFlipped = forceState;
  } else {
    scifiFlipped = !scifiFlipped;
  }
  card.classList.toggle('flipped', scifiFlipped);
}

function manualFlipPortal(e) {
  // If user clicked an editable element, input, button or modal, NEVER flip!
  if (e && e.target && (e.target.closest('.editable') || e.target.closest('button') || e.target.closest('input') || e.target.closest('textarea') || e.target.closest('.scifi-edit-actions') || e.target.closest('.modal-overlay'))) {
    return;
  }
  // In Edit Mode: rotate ONLY when explicitly intended
  flipPortal();
  // ONLY start auto-timer if NOT in edit mode!
  if (!document.body.classList.contains('edit-mode')) {
    startScifiTimer();
  }
}

function startScifiTimer() {
  if (scifiTimer) {
    clearInterval(scifiTimer);
    scifiTimer = null;
  }
  // CRITICAL: NEVER run auto-timer while in Edit Mode!
  if (document.body.classList.contains('edit-mode')) {
    return;
  }
  scifiTimer = setInterval(() => {
    // If edit mode became active, terminate timer immediately
    if (document.body.classList.contains('edit-mode')) {
      if (scifiTimer) { clearInterval(scifiTimer); scifiTimer = null; }
      return;
    }
    // If user is focusing/typing in any editable element, do not flip
    const active = document.activeElement;
    if (active && (active.classList.contains('editable') || active.closest('#scifiPortal')?.querySelector('.editable:focus'))) {
      return;
    }
    flipPortal();
  }, 5000);
}


/* ============================================================
   IMAGE COMPRESSION UTILITY (Downscales mobile photos to ~60KB)
   ============================================================ */
function compressImage(file, maxDim = 600, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        if (w > h) {
          if (w > maxDim) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          }
        } else {
          if (h > maxDim) {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('Image load failed'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('File read failed'));
    reader.readAsDataURL(file);
  });
}

function triggerScifiAvatarUpload(e) {
  if (e) {
    if (typeof e.preventDefault === 'function') e.preventDefault();
    if (typeof e.stopPropagation === 'function') e.stopPropagation();
  }
  if (typeof flipPortal === 'function') flipPortal(false); // Show Face A (photo)
  const input = document.getElementById('scifiAvatarInput');
  if (input) input.click();
}
window.triggerScifiAvatarUpload = triggerScifiAvatarUpload;

function initScifiPortal() {
  startScifiTimer();

  // Pause on mouse hover, resume on mouse leave
  const portal = document.getElementById('scifiPortal');
  if (portal) {
    portal.addEventListener('mouseenter', () => {
      if (scifiTimer) clearInterval(scifiTimer);
    });
    portal.addEventListener('mouseleave', () => {
      if (!document.body.classList.contains('edit-mode')) startScifiTimer();
    });
  }

  // Handle Sci-Fi Avatar Upload (with automatic mobile photo compression)
  const avatarInput = document.getElementById('scifiAvatarInput');
  if (avatarInput) {
    avatarInput.addEventListener('change', async function() {
      const file = this.files[0];
      if (!file) return;
      showToast('⏳ Photo process ho rahi hai...', 'info');
      try {
        const compressedDataUrl = await compressImage(file, 600, 0.85);
        const img = document.getElementById('scifiAvatarImg');
        if (img) {
          img.src = compressedDataUrl;
          img.style.display = 'block';
        }
        const d = getSavedData();
        d.scifiAvatar = compressedDataUrl;
        saveData(d);
        if (portfolioData) {
          portfolioData.settings = portfolioData.settings || {};
          portfolioData.settings.scifiAvatar = compressedDataUrl;
        }
        if (typeof flipPortal === 'function') flipPortal(false);
        showToast('📸 Profile Photo update ho gayi! Save ya Publish karein.');
      } catch (err) {
        console.error('Avatar upload error:', err);
        showToast('❌ Photo upload error: ' + err.message, 'error');
      }
      this.value = '';
    });
  }
}
window.manualFlipPortal = manualFlipPortal;


/* ============================================================
   BLENDER ADDONS SYSTEM (Upload / Download / Manage)
   ============================================================ */
const DEFAULT_ADDONS = [
  {
    id: 'addon_1',
    title: 'ArchViz QuickTools Pro',
    version: 'v2.4',
    blender: 'Blender 3.6 / 4.x',
    category: 'ArchViz & Lighting',
    desc: 'Automated parametric wall generation, trim moldings, and photorealistic lighting studio setups for Blender Cycles & Eevee.',
    icon: 'fa-building',
    fileUrl: '#',
    downloads: '1.4k+'
  },
  {
    id: 'addon_2',
    title: 'Parametric Stairs & Railings',
    version: 'v1.8',
    blender: 'Blender 4.0 / 4.2+',
    category: 'Geometry Nodes',
    desc: 'Interactive geometry-nodes generator for spiral, cantilever, and modern industrial staircases with dynamic balustrade controls.',
    icon: 'fa-stairs',
    fileUrl: '#',
    downloads: '890+'
  },
  {
    id: 'addon_3',
    title: 'Cinematic Camera Rigs',
    version: 'v1.2',
    blender: 'Blender 3.6+',
    category: 'Animation',
    desc: 'One-click architectural flythrough rigs with smooth camera easing, drone pathing, target tracking, and rack focus presets.',
    icon: 'fa-video',
    fileUrl: '#',
    downloads: '620+'
  }
];

function getAddons() {
  const saved = getSavedData();
  if (saved.addons && Array.isArray(saved.addons) && saved.addons.length > 0) {
    return saved.addons;
  }
  if (portfolioData && portfolioData.addons && Array.isArray(portfolioData.addons) && portfolioData.addons.length > 0) {
    return portfolioData.addons;
  }
  return DEFAULT_ADDONS;
}

function saveAddons(addonsList) {
  const d = getSavedData();
  d.addons = addonsList;
  saveData(d);
  if (portfolioData) {
    portfolioData.addons = addonsList;
  }
}

/* ============================================================
   BLENDER ADDONS: SLIDE VIEW CAROUSEL ENGINE (v22.4)
   Supports up to 100+ Addons with Carousel Sliding, Filter & Search
   ============================================================ */

let currentAddonCategory     = 'all';
let currentAddonSearchQuery  = '';
let currentAddonSlideIndex   = 0;
let lastFilteredAddons       = [];
let addonAutoSlideTimer      = null;
let isAddonAutoSlidePaused   = false;
const ADDON_AUTO_INTERVAL    = 6000;
let addonListenersBound      = false;

function getCardsPerPage() {
  const w = window.innerWidth;
  if (w <= 680) return 1;
  if (w <= 1080) return 2;
  return 3;
}

function getFilteredAddons() {
  const allAddons = getAddons();
  return allAddons.filter(addon => {
    // 1. Category filter
    let matchCat = true;
    if (currentAddonCategory !== 'all') {
      const catLower = (addon.category || '').toLowerCase();
      const targetLower = currentAddonCategory.toLowerCase();
      matchCat = catLower.includes(targetLower);
    }

    // 2. Search query filter
    let matchQuery = true;
    if (currentAddonSearchQuery) {
      const q = currentAddonSearchQuery.toLowerCase();
      const title = (addon.title || '').toLowerCase();
      const desc = (addon.desc || '').toLowerCase();
      const cat = (addon.category || '').toLowerCase();
      const blender = (addon.blender || '').toLowerCase();
      matchQuery = title.includes(q) || desc.includes(q) || cat.includes(q) || blender.includes(q);
    }

    return matchCat && matchQuery;
  });
}

function renderAddons() {
  const track = document.getElementById('addonsTrack');
  const empty = document.getElementById('addonsEmptyState');
  const carouselWrap = document.getElementById('addonsCarouselWrap');
  const footerWrap = document.querySelector('.addons-carousel-footer');
  const countNum = document.getElementById('addonsCountNum');
  if (!track) return;

  lastFilteredAddons = getFilteredAddons();

  // Update counter badge
  if (countNum) countNum.textContent = lastFilteredAddons.length;

  // Handle empty state
  if (!lastFilteredAddons.length) {
    track.innerHTML = '';
    if (carouselWrap) carouselWrap.style.display = 'none';
    if (footerWrap) footerWrap.style.display = 'none';
    if (empty) {
      empty.style.display = 'block';
      const msg = document.getElementById('addonsEmptyMsg');
      if (msg) {
        msg.textContent = currentAddonSearchQuery
          ? `"${currentAddonSearchQuery}" se match karne wala koi addon nahi mila.`
          : 'Is category mein filhal koi addon nahi hai.';
      }
    }
    stopAddonAutoSlide();
    return;
  }

  if (carouselWrap) carouselWrap.style.display = 'block';
  if (footerWrap) footerWrap.style.display = 'flex';
  if (empty) empty.style.display = 'none';

  // Render cards
  track.innerHTML = lastFilteredAddons.map(addon => {
    const downloadAction = (addon.fileUrl && addon.fileUrl !== '#') 
      ? `href="${addon.fileUrl}" download="${addon.title.replace(/[^a-zA-Z0-9_-]/g, '_')}.zip" target="_blank"`
      : `href="javascript:void(0)" onclick="triggerSampleAddonDownload('${addon.id}')"`;

    return `
      <div class="addon-card" id="card-${addon.id}">
        <div>
          <div class="addon-card-top">
            <div class="addon-icon-box">
              <i class="fa-solid ${addon.icon || 'fa-cube'}"></i>
            </div>
            <div class="addon-meta-badges">
              <span class="addon-version-pill">${addon.version || 'v1.0'}</span>
              <span class="addon-cat-pill">${addon.category || 'Blender Addon'}</span>
            </div>
          </div>
          <h3 class="addon-title">${addon.title}</h3>
          <div class="addon-compat">
            <i class="fa-brands fa-blender"></i> ${addon.blender || 'Blender 3.6 / 4.x'}
          </div>
          <p class="addon-desc" title="${addon.desc || ''}">${addon.desc || 'Parametric tools and workflows for Blender.'}</p>
        </div>
        <div class="addon-card-bottom">
          <div class="addon-downloads-stat">
            <i class="fas fa-download"></i> ${addon.downloads || 'Free'}
          </div>
          <div style="display:flex;align-items:center;gap:.6rem;">
            <div class="addon-edit-actions">
              <button type="button" class="btn-addon-action" onclick="openAddonModal('${addon.id}')" title="Edit Addon"><i class="fas fa-pen"></i></button>
              <button type="button" class="btn-addon-action del" onclick="deleteAddon('${addon.id}')" title="Delete Addon"><i class="fas fa-trash"></i></button>
            </div>
            <a ${downloadAction} class="btn-addon-download">
              <i class="fas fa-cloud-arrow-down"></i> Download
            </a>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Render dots
  renderAddonDots();

  // Position track
  updateAddonsTrackPosition();

  // Start auto-slide if more than cardsPerPage
  const cardsPerPage = getCardsPerPage();
  if (lastFilteredAddons.length > cardsPerPage) {
    startAddonAutoSlide();
  } else {
    stopAddonAutoSlide();
  }

  // Bind mouse/touch listeners once
  bindAddonCarouselListeners();
}

function renderAddonDots() {
  const dotsContainer = document.getElementById('addonsPaginationDots');
  if (!dotsContainer) return;

  const cardsPerPage = getCardsPerPage();
  const maxIdx = Math.max(0, lastFilteredAddons.length - cardsPerPage);
  const totalSteps = maxIdx + 1;

  if (totalSteps <= 1) {
    dotsContainer.innerHTML = '';
    return;
  }

  // To prevent overcrowding when having 100 addons, limit dots to at most 10 or pages
  const stepCount = Math.min(totalSteps, 10);
  let html = '';
  for (let i = 0; i < stepCount; i++) {
    const targetIdx = Math.round((i / (stepCount - 1)) * maxIdx);
    html += `<span class="addon-dot" onclick="jumpToAddonSlide(${targetIdx})" title="Slide ${targetIdx + 1}"></span>`;
  }
  dotsContainer.innerHTML = html;
}

function updateAddonsTrackPosition() {
  const track = document.getElementById('addonsTrack');
  const viewport = document.getElementById('addonsViewport');
  if (!track || !viewport) return;

  const cardsPerPage = getCardsPerPage();
  const maxIdx = Math.max(0, lastFilteredAddons.length - cardsPerPage);
  if (currentAddonSlideIndex > maxIdx) currentAddonSlideIndex = maxIdx;
  if (currentAddonSlideIndex < 0) currentAddonSlideIndex = 0;

  const firstCard = track.querySelector('.addon-card');
  if (!firstCard) return;

  const cardRect = firstCard.getBoundingClientRect();
  const gap = parseFloat(window.getComputedStyle(track).gap) || 24;
  const step = cardRect.width + gap;

  track.style.transform = `translateX(-${currentAddonSlideIndex * step}px)`;

  // Update dots
  const dots = document.querySelectorAll('.addon-dot');
  if (dots.length > 0) {
    const activeDotIdx = Math.round((currentAddonSlideIndex / (maxIdx || 1)) * (dots.length - 1));
    dots.forEach((dot, idx) => {
      dot.classList.toggle('active', idx === activeDotIdx);
    });
  }

  // Update counter
  const counter = document.getElementById('addonsPageCounter');
  if (counter) {
    const total = lastFilteredAddons.length;
    const start = Math.min(total, currentAddonSlideIndex + 1);
    const end = Math.min(total, currentAddonSlideIndex + cardsPerPage);
    counter.textContent = `Showing ${start}-${end} of ${total} Addons`;
  }
}

function nextAddonSlide() {
  const cardsPerPage = getCardsPerPage();
  const maxIdx = Math.max(0, lastFilteredAddons.length - cardsPerPage);
  if (maxIdx === 0) return;

  currentAddonSlideIndex = (currentAddonSlideIndex >= maxIdx) ? 0 : currentAddonSlideIndex + 1;
  updateAddonsTrackPosition();
}

function prevAddonSlide() {
  const cardsPerPage = getCardsPerPage();
  const maxIdx = Math.max(0, lastFilteredAddons.length - cardsPerPage);
  if (maxIdx === 0) return;

  currentAddonSlideIndex = (currentAddonSlideIndex <= 0) ? maxIdx : currentAddonSlideIndex - 1;
  updateAddonsTrackPosition();
}

function jumpToAddonSlide(idx) {
  const cardsPerPage = getCardsPerPage();
  const maxIdx = Math.max(0, lastFilteredAddons.length - cardsPerPage);
  currentAddonSlideIndex = Math.min(idx, maxIdx);
  updateAddonsTrackPosition();
}

// Category filter
function filterAddonsByCategory(cat) {
  currentAddonCategory = cat;
  currentAddonSlideIndex = 0;

  document.querySelectorAll('.addon-filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.cat === cat);
  });

  renderAddons();
}

// Search filter
function handleAddonSearch(query) {
  currentAddonSearchQuery = (query || '').trim();
  currentAddonSlideIndex = 0;

  const clearBtn = document.getElementById('btnClearAddonSearch');
  if (clearBtn) clearBtn.style.display = currentAddonSearchQuery ? 'inline-block' : 'none';

  renderAddons();
}

function clearAddonSearch() {
  const input = document.getElementById('addonSearchInput');
  if (input) input.value = '';
  handleAddonSearch('');
}

// Auto-Slide Controls
function startAddonAutoSlide() {
  stopAddonAutoSlide();
  addonAutoSlideTimer = setInterval(() => {
    if (!isAddonAutoSlidePaused) {
      nextAddonSlide();
    }
  }, ADDON_AUTO_INTERVAL);
}

function stopAddonAutoSlide() {
  if (addonAutoSlideTimer) {
    clearInterval(addonAutoSlideTimer);
    addonAutoSlideTimer = null;
  }
}

function pauseAddonAutoSlide(paused) {
  isAddonAutoSlidePaused = paused;
  const pill = document.getElementById('addonAutoPill');
  const icon = document.getElementById('addonAutoIcon');
  const text = document.getElementById('addonAutoText');
  if (pill) {
    pill.classList.toggle('paused', paused);
    if (icon) icon.className = paused ? 'fas fa-pause' : 'fas fa-rotate';
    if (text) text.textContent = paused ? 'PAUSED' : '6s AUTO';
  }
}

function toggleAddonAutoSlide() {
  pauseAddonAutoSlide(!isAddonAutoSlidePaused);
}

function bindAddonCarouselListeners() {
  if (addonListenersBound) return;
  addonListenersBound = true;

  const vp = document.getElementById('addonsViewport');
  if (vp) {
    vp.addEventListener('mouseenter', () => pauseAddonAutoSlide(true));
    vp.addEventListener('mouseleave', () => pauseAddonAutoSlide(false));
    vp.addEventListener('touchstart', () => pauseAddonAutoSlide(true), { passive: true });
    vp.addEventListener('touchend',   () => pauseAddonAutoSlide(false), { passive: true });
  }

  window.addEventListener('resize', () => {
    renderAddonDots();
    updateAddonsTrackPosition();
  });
}



function openAddonModal(addonId) {
  const modal = document.getElementById('addonModal');
  if (!modal) return;
  modal.style.display = 'flex';

  const modalTitle = document.getElementById('addonModalTitle');
  const editId = document.getElementById('addonEditId');
  const inTitle = document.getElementById('addonInputTitle');
  const inVersion = document.getElementById('addonInputVersion');
  const inBlender = document.getElementById('addonInputBlender');
  const inCat = document.getElementById('addonInputCategory');
  const inDesc = document.getElementById('addonInputDesc');
  const inUrl = document.getElementById('addonInputUrl');

  if (addonId) {
    const addon = getAddons().find(a => a.id === addonId);
    if (addon) {
      if (modalTitle) modalTitle.textContent = 'Edit Blender Addon';
      if (editId) editId.value = addon.id;
      if (inTitle) inTitle.value = addon.title || '';
      if (inVersion) inVersion.value = addon.version || '';
      if (inBlender) inBlender.value = addon.blender || '';
      if (inCat) inCat.value = addon.category || '';
      if (inDesc) inDesc.value = addon.desc || '';
      if (inUrl) inUrl.value = addon.fileUrl || '';
      return;
    }
  }

  // New addon
  if (modalTitle) modalTitle.textContent = 'Add New Blender Addon';
  if (editId) editId.value = '';
  if (inTitle) inTitle.value = '';
  if (inVersion) inVersion.value = 'v1.0';
  if (inBlender) inBlender.value = 'Blender 4.0 / 4.2+';
  if (inCat) inCat.value = 'ArchViz / Tools';
  if (inDesc) inDesc.value = '';
  if (inUrl) inUrl.value = '';
}

function closeAddonModal() {
  const modal = document.getElementById('addonModal');
  if (modal) modal.style.display = 'none';
}

function saveAddonFromModal() {
  const editId = document.getElementById('addonEditId')?.value?.trim();
  const title = document.getElementById('addonInputTitle')?.value?.trim();
  const version = document.getElementById('addonInputVersion')?.value?.trim() || 'v1.0';
  const blender = document.getElementById('addonInputBlender')?.value?.trim() || 'Blender 4.x';
  const category = document.getElementById('addonInputCategory')?.value?.trim() || 'Addon';
  const desc = document.getElementById('addonInputDesc')?.value?.trim() || '';
  const fileUrl = document.getElementById('addonInputUrl')?.value?.trim() || '#';

  if (!title) {
    showToast('Addon Name enter karein!', 'error');
    return;
  }

  const addons = getAddons();
  if (editId) {
    // Edit existing
    const idx = addons.findIndex(a => a.id === editId);
    if (idx !== -1) {
      addons[idx] = { ...addons[idx], title, version, blender, category, desc, fileUrl };
    }
  } else {
    // Add new
    const newId = 'addon_' + Date.now();
    addons.unshift({
      id: newId,
      title,
      version,
      blender,
      category,
      desc,
      fileUrl,
      icon: 'fa-cube',
      downloads: '0'
    });
  }

  saveAddons(addons);
  renderAddons();
  closeAddonModal();
  showToast('✅ Blender Addon save ho gaya! (Publish Live kar ke online bhejein)');
}

function deleteAddon(addonId) {
  if (!confirm('Kya aap is Blender Addon ko delete karna chahte hain?')) return;
  const addons = getAddons().filter(a => a.id !== addonId);
  saveAddons(addons);
  renderAddons();
  showToast('🗑️ Addon delete ho gaya!');
}

function handleAddonFileUpload(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const dataUrl = e.target.result;
    const inUrl = document.getElementById('addonInputUrl');
    if (inUrl) inUrl.value = dataUrl;
    showToast(`📦 "${file.name}" ready for download!`);
  };
  reader.readAsDataURL(file);
}

function triggerSampleAddonDownload(addonId) {
  const addon = getAddons().find(a => a.id === addonId);
  const title = addon ? addon.title : 'Design_Corner_Addon';
  const pyCode = `# Blender Addon: ${title}
# Created for Design Corner Portfolio
bl_info = {
    "name": "${title}",
    "author": "Design Corner",
    "version": (1, 0),
    "blender": (4, 0, 0),
    "location": "View3D > Sidebar > Design Corner",
    "description": "Architectural visualization and 3D utility tools",
    "category": "3D View",
}

import bpy

class DESIGN_PT_MainPanel(bpy.types.Panel):
    bl_label = "Design Corner Tools"
    bl_idname = "DESIGN_PT_main_panel"
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = 'Design Corner'

    def draw(self, context):
        layout = self.layout
        layout.label(text="Welcome to ${title}!", icon='SOLO_ON')
        layout.operator("wm.url_open", text="Visit Design Corner").url = "https://designcorner488.github.io"

def register():
    bpy.utils.register_class(DESIGN_PT_MainPanel)

def unregister():
    bpy.utils.unregister_class(DESIGN_PT_MainPanel)

if __name__ == "__main__":
    register()
`;
  const blob = new Blob([pyCode], { type: 'text/x-python' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${title.replace(/[^a-zA-Z0-9_-]/g, '_')}.py`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showToast(`⚡ "${title}.py" download ho gaya!`);
}

function initAddonsSystem() {
  renderAddons();
}

window.openAddonModal = openAddonModal;
window.closeAddonModal = closeAddonModal;
window.saveAddonFromModal = saveAddonFromModal;
window.deleteAddon = deleteAddon;
window.handleAddonFileUpload = handleAddonFileUpload;
window.triggerSampleAddonDownload = triggerSampleAddonDownload;


function bootPortfolio() {
  try { initLoader(); } catch(e) { console.warn(e); }
  try { initCursor(); } catch(e) { console.warn(e); }
  try { initParticles(); } catch(e) { console.warn(e); }
  try { initNavbar(); } catch(e) { console.warn(e); }
  try { initAOS(); } catch(e) { console.warn(e); }
  try { initSkillBars(); } catch(e) { console.warn(e); }
  try { initLightbox(); } catch(e) { console.warn(e); }
  try { initContactForm(); } catch(e) { console.warn(e); }
  try { setFooterYear(); } catch(e) { console.warn(e); }
  try { initEditMode(); } catch(e) { console.warn(e); }
  try { initGLBViewer(); } catch(e) { console.warn(e); }
  try { initScifiPortal(); } catch(e) { console.warn(e); }
  try { initAddonsSystem(); } catch(e) { console.warn(e); }
  loadPortfolio().catch(err => {
    console.error('loadPortfolio error:', err);
    showGalleryEmpty();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootPortfolio);
} else {
  bootPortfolio();
}


/* ============================================================
   SCI-FI CIRCLE TEXT EDIT MODAL LOGIC
   ============================================================ */
function openScifiModal(e) {
  if (e) {
    if (typeof e.preventDefault === 'function') e.preventDefault();
    if (typeof e.stopPropagation === 'function') e.stopPropagation();
  }
  const modal = document.getElementById('scifiTextModal');
  if (!modal) return;

  const getTxt = (key, fallback = '') => {
    const el = document.querySelector(`[data-key="${key}"]`);
    return el ? el.textContent.trim() : fallback;
  };

  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  };

  setVal('mScifiCallsign',  getTxt('scifiCallsign', 'DESIGN CORNER'));
  setVal('mScifiRank',      getTxt('scifiRank', 'ARCHITECT & 3D ARTIST'));
  setVal('mScifiStatus',    getTxt('scifiStatus', 'SYS // ONLINE'));
  setVal('mScifiTermTag',   getTxt('scifiTermTag', 'CORE // 3D MATRIX'));
  setVal('mScifiTermTitle', getTxt('scifiTermTitle', 'BLENDER 3D // BIM'));
  setVal('mScifiTermDesc',  getTxt('scifiTermDesc', 'Photorealistic architectural renders, parametric geometry nodes & motion design.'));
  setVal('mScifiBadge1',    getTxt('scifiBadge1', 'Blender 4.x'));
  setVal('mScifiBadge2',    getTxt('scifiBadge2', 'Revit & D5'));

  modal.style.display = 'flex';
}

function closeScifiModal() {
  const modal = document.getElementById('scifiTextModal');
  if (modal) modal.style.display = 'none';
}

function saveScifiModal() {
  const getVal = id => document.getElementById(id)?.value?.trim() || '';
  const setDOM = (key, val) => {
    const el = document.querySelector(`[data-key="${key}"]`);
    if (el && val) el.innerHTML = val;
  };

  const fields = {
    scifiCallsign:  getVal('mScifiCallsign'),
    scifiRank:      getVal('mScifiRank'),
    scifiStatus:    getVal('mScifiStatus'),
    scifiTermTag:   getVal('mScifiTermTag'),
    scifiTermTitle: getVal('mScifiTermTitle'),
    scifiTermDesc:  getVal('mScifiTermDesc'),
    scifiBadge1:    getVal('mScifiBadge1'),
    scifiBadge2:    getVal('mScifiBadge2')
  };

  // Update DOM
  Object.entries(fields).forEach(([key, val]) => {
    if (val) setDOM(key, val);
  });

  // Save to localStorage
  const d = getSavedData();
  d.text = d.text || {};
  Object.assign(d.text, fields);
  saveData(d);

  // Update portfolioData if present
  if (portfolioData) {
    portfolioData._textOverrides = portfolioData._textOverrides || {};
    Object.assign(portfolioData._textOverrides, fields);
    portfolioData.settings = portfolioData.settings || {};
    portfolioData.settings.scifiPortal = portfolioData.settings.scifiPortal || {};
    portfolioData.settings.scifiPortal.callsign  = fields.scifiCallsign;
    portfolioData.settings.scifiPortal.rank      = fields.scifiRank;
    portfolioData.settings.scifiPortal.status    = fields.scifiStatus;
    portfolioData.settings.scifiPortal.termTag   = fields.scifiTermTag;
    portfolioData.settings.scifiPortal.termTitle = fields.scifiTermTitle;
    portfolioData.settings.scifiPortal.termDesc  = fields.scifiTermDesc;
    portfolioData.settings.scifiPortal.badge1    = fields.scifiBadge1;
    portfolioData.settings.scifiPortal.badge2    = fields.scifiBadge2;
  }

  closeScifiModal();
  showToast('✅ Sci-Fi Circle Text Update ho gaya! "Publish Live" daba kar live karein.');
}

window.openScifiModal  = openScifiModal;
window.closeScifiModal = closeScifiModal;
window.saveScifiModal  = saveScifiModal;


/* ============================================================
   TOOLS & SKILLS INTERACTIVE 3D & MP4 SHOWCASE ENGINE
   ============================================================ */
const DEFAULT_SKILL_TOOLS = [
  {
    idx: 0,
    name: 'Blender 3D',
    tag: 'CYCLES & EEVEE RENDER',
    type: 'video',
    url: 'https://designcorner488.github.io/media/hvac_samply_.mp4'
  },
  {
    idx: 1,
    name: 'Autodesk Revit',
    tag: 'BIM ARCHITECTURE',
    type: 'video',
    url: 'https://designcorner488.github.io/media/bim_animation_1.mp4'
  },
  {
    idx: 2,
    name: 'D5 Render',
    tag: 'REAL-TIME PHOTOREAL',
    type: 'video',
    url: 'https://designcorner488.github.io/media/2_7.mp4'
  },
  {
    idx: 3,
    name: '3D Animation',
    tag: 'CINEMATIC MOTION',
    type: 'video',
    url: 'https://github.com/designcorner488/designcorner488.github.io/releases/download/v1.0/all_in_one_try.mp4'
  },
  {
    idx: 4,
    name: 'Architecture',
    tag: 'FLYTHROUGH & 3D VIZ',
    type: 'video',
    url: 'https://designcorner488.github.io/media/2_3.mp4'
  },
  {
    idx: 5,
    name: 'Product Design',
    tag: 'INTERACTIVE 3D MODEL',
    type: 'glb',
    url: 'https://designcorner488.github.io/media/Meshy_AI_Ornate_Wooden_Dining__1031072807_texture.glb'
  }
];

let currentSkillToolIdx = 0;
let skillAutoTimer = null;
let currentUploadingToolIdx = 0;

function getSkillToolData(idx) {
  const saved = getSavedData()?.skillMedia?.[idx] || portfolioData?.settings?.skillMedia?.[idx];
  if (saved && saved.url) {
    return { ...DEFAULT_SKILL_TOOLS[idx], ...saved };
  }
  return DEFAULT_SKILL_TOOLS[idx] || DEFAULT_SKILL_TOOLS[0];
}

function selectSkillTool(idx, manual = true) {
  if (idx < 0 || idx >= DEFAULT_SKILL_TOOLS.length) idx = 0;
  currentSkillToolIdx = idx;

  const tool = getSkillToolData(idx);

  // Update Skill Cards Active State
  const cards = document.querySelectorAll('.skills-grid .skill-card');
  cards.forEach((card, i) => {
    card.classList.toggle('active', i === idx);
  });

  // Update Viewport HUD Info
  const nameEl = document.getElementById('vpToolName');
  const tagEl  = document.getElementById('vpToolTag');
  const typeEl = document.getElementById('vpTypeBadge');
  const btnToolEl = document.getElementById('vpUploadBtnToolName');

  if (nameEl) nameEl.textContent = tool.name;
  if (tagEl)  tagEl.textContent  = tool.tag || 'RENDER PREVIEW';
  if (btnToolEl) btnToolEl.textContent = tool.name;

  // Update Dots
  const dots = document.querySelectorAll('.viewport-dots .vp-dot');
  dots.forEach((dot, i) => {
    dot.classList.toggle('active', i === idx);
  });

  // Switch Media (Video vs 3D Model)
  const video = document.getElementById('vpVideo');
  const model = document.getElementById('vpModel');
  const hint3d = document.getElementById('vp3dHint');
  const loader = document.getElementById('vpLoading');

  const isGlb = tool.type === 'glb' || (tool.url && tool.url.toLowerCase().includes('.glb'));

  if (typeEl) {
    typeEl.innerHTML = isGlb 
      ? '<i class="fas fa-cube"></i> 3D GLB MODEL' 
      : '<i class="fas fa-video"></i> MP4 VIDEO';
    typeEl.style.color = isGlb ? '#00f0ff' : '#a855f7';
    typeEl.style.borderColor = isGlb ? 'rgba(0,240,255,0.4)' : 'rgba(168,85,247,0.4)';
  }

  if (isGlb) {
    if (video) { video.pause(); video.style.display = 'none'; }
    if (model) {
      model.style.display = 'block';
      if (model.src !== tool.url) {
        if (loader) loader.style.display = 'flex';
        model.src = tool.url;
        model.onload = () => { if (loader) loader.style.display = 'none'; };
        setTimeout(() => { if (loader) loader.style.display = 'none'; }, 1800);
      }
    }
    if (hint3d) hint3d.style.display = 'flex';
  } else {
    if (model) { model.style.display = 'none'; }
    if (hint3d) hint3d.style.display = 'none';
    if (video) {
      video.style.display = 'block';
      if (video.src !== tool.url) {
        if (loader) loader.style.display = 'flex';
        video.src = tool.url;
        video.onloadeddata = () => { if (loader) loader.style.display = 'none'; };
        video.play().catch(() => {});
        setTimeout(() => { if (loader) loader.style.display = 'none'; }, 1000);
      } else {
        video.play().catch(() => {});
      }
    }
  }

  if (manual && !document.body.classList.contains('edit-mode')) {
    startSkillAutoTimer();
  }
}

function nextSkillTool() {
  selectSkillTool((currentSkillToolIdx + 1) % DEFAULT_SKILL_TOOLS.length, true);
}

function prevSkillTool() {
  selectSkillTool((currentSkillToolIdx + DEFAULT_SKILL_TOOLS.length - 1) % DEFAULT_SKILL_TOOLS.length, true);
}

function startSkillAutoTimer() {
  if (skillAutoTimer) {
    clearInterval(skillAutoTimer);
    skillAutoTimer = null;
  }
  if (document.body.classList.contains('edit-mode')) return;

  skillAutoTimer = setInterval(() => {
    if (document.body.classList.contains('edit-mode')) {
      if (skillAutoTimer) { clearInterval(skillAutoTimer); skillAutoTimer = null; }
      return;
    }
    selectSkillTool((currentSkillToolIdx + 1) % DEFAULT_SKILL_TOOLS.length, false);
  }, 5000);
}

function triggerToolMediaUpload(idx) {
  currentUploadingToolIdx = idx;
  selectSkillTool(idx, true);
  const input = document.getElementById('skillMediaFileInput');
  if (input) input.click();
}

function triggerActiveToolMediaUpload() {
  triggerToolMediaUpload(currentSkillToolIdx);
}

function initSkillShowcase() {
  const panel = document.getElementById('skillsViewportPanel');
  if (panel) {
    // Pause auto-cycle when hovering over viewport screen
    panel.addEventListener('mouseenter', () => {
      if (skillAutoTimer) clearInterval(skillAutoTimer);
    });
    panel.addEventListener('mouseleave', () => {
      if (!document.body.classList.contains('edit-mode')) startSkillAutoTimer();
    });
  }

  // Handle Skill Media File Upload
  const fileInput = document.getElementById('skillMediaFileInput');
  if (fileInput) {
    fileInput.addEventListener('change', async function() {
      const file = this.files[0];
      if (!file) return;

      const toolIdx = currentUploadingToolIdx;
      const toolName = DEFAULT_SKILL_TOOLS[toolIdx]?.name || 'Tool';
      const isGlb = file.name.toLowerCase().endsWith('.glb');
      const ext = isGlb ? '.glb' : '.mp4';
      const safeName = `skill_${toolIdx}_` + file.name.replace(/[^a-zA-Z0-9._-]/g, '_');

      showToast(`⏳ ${toolName} ka media process ho raha hai...`, 'info');

      try {
        // Read as Blob & DataURL
        const blob = file;
        const dataUrl = await new Promise((res, rej) => {
          const r = new FileReader();
          r.onload = e => res(e.target.result);
          r.onerror = rej;
          r.readAsDataURL(file);
        });

        // Store in IndexedDB for persistent local & publish pipeline
        try {
          await dbSaveItem({
            id: 'skill_media_' + toolIdx,
            name: safeName,
            type: isGlb ? 'glb' : 'video',
            blob: blob,
            size: file.size,
            date: new Date().toISOString()
          });
        } catch(e) { console.warn('IDB skill media save note:', e); }

        // Update local memory
        const d = getSavedData();
        d.skillMedia = d.skillMedia || {};
        d.skillMedia[toolIdx] = {
          idx: toolIdx,
          name: toolName,
          type: isGlb ? 'glb' : 'video',
          url: dataUrl
        };
        saveData(d);

        // Update portfolioData
        if (portfolioData) {
          portfolioData.settings = portfolioData.settings || {};
          portfolioData.settings.skillMedia = portfolioData.settings.skillMedia || {};
          portfolioData.settings.skillMedia[toolIdx] = {
            idx: toolIdx,
            name: toolName,
            type: isGlb ? 'glb' : 'video',
            url: dataUrl
          };
        }

        // Immediately update display screen
        selectSkillTool(toolIdx, true);
        showToast(`✅ ${toolName} ke liye ${isGlb ? '3D GLB' : 'MP4 Video'} update ho gaya! "Publish Live" karein.`);
      } catch(err) {
        console.error('Skill media upload error:', err);
        showToast('❌ Upload error: ' + err.message, 'error');
      }

      this.value = '';
    });
  }

  // Load first tool
  selectSkillTool(0, false);
  startSkillAutoTimer();
}

window.selectSkillTool = selectSkillTool;
window.nextSkillTool = nextSkillTool;
window.prevSkillTool = prevSkillTool;
window.triggerToolMediaUpload = triggerToolMediaUpload;
window.triggerActiveToolMediaUpload = triggerActiveToolMediaUpload;


/* ============================================================
   FEATURED PROJECTS: CINEMATIC SHOWCASE SLIDER ENGINE (v22.2)
   ============================================================ */

let activeSlideCategory        = 'all';
let categorySlideProjects      = [];
let currentProjectSlideIdx     = 0;
let projectSliderTimer         = null;
let projectSliderProgressTimer = null;
let projectSliderStartTime     = 0;
let isProjectSliderPaused      = false;
const PROJECT_SLIDE_DURATION   = 5000;
let currentProjectsViewMode    = 'slider';
let pendingSlideMedia          = null;

function getProjects() {
  const saved = getSavedData();
  if (saved && saved.projects && Array.isArray(saved.projects) && saved.projects.length > 0) {
    // If local cache contains old youtube demo entries or has less than 10 items, purge it to show fresh 25 client examples
    if (saved.projects.some(p => p.type === 'youtube' || p.id === 'demo-3') || saved.projects.length < 15) {
      delete saved.projects;
      saveData(saved);
    } else {
      return saved.projects;
    }
  }
  if (portfolioData && portfolioData.projects && Array.isArray(portfolioData.projects) && portfolioData.projects.length > 0) {
    return portfolioData.projects;
  }
  return [];
}

function saveProjects(projectsList) {
  const d = getSavedData();
  d.projects = projectsList;
  saveData(d);
  if (portfolioData) {
    portfolioData.projects = projectsList;
  }
  filteredProjects = activeSlideCategory === 'all'
    ? projectsList
    : projectsList.filter(p => p.category === activeSlideCategory);
  renderGallery();
}

function initProjectShowcaseSlider() {
  const container = document.getElementById('projectsSliderContainer');
  if (!container) return;

  // Hover & touch pause listeners
  container.addEventListener('mouseenter', () => pauseProjectSlider(true));
  container.addEventListener('mouseleave', () => pauseProjectSlider(false));
  container.addEventListener('touchstart', () => pauseProjectSlider(true), { passive: true });
  container.addEventListener('touchend',   () => pauseProjectSlider(false), { passive: true });

  // Keyboard navigation when hovering
  container.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') prevProjectSlide();
    if (e.key === 'ArrowRight') nextProjectSlide();
  });

  // Initial category setup
  switchProjectCategory('all', true);
}

function switchProjectCategory(catId, forceInit = false) {
  activeSlideCategory = catId;
  const allProjects = getProjects();

  categorySlideProjects = (catId === 'all')
    ? allProjects
    : allProjects.filter(p => p.category === catId);

  currentProjectSlideIdx = 0;

  // Update Add Slide button text to match category
  const addBtn = document.getElementById('btnAddSlideText');
  if (addBtn) {
    const catLabel = getCategoryLabel(catId);
    addBtn.textContent = (catId === 'all') ? 'Add Slide' : `Add ${catLabel} Slide`;
  }

  // Sync category filter buttons
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.cat === catId);
  });

  const container = document.getElementById('projectsSliderContainer');
  const emptyCard = document.getElementById('sliderEmptyCard');

  if (!categorySlideProjects.length) {
    if (container) container.style.display = 'none';
    if (emptyCard) {
      emptyCard.style.display = 'block';
      const catLabel = getCategoryLabel(catId);
      const titleEl = document.getElementById('sliderEmptyTitle');
      const subEl = document.getElementById('sliderEmptySub');
      if (titleEl) titleEl.textContent = `No Projects in ${catLabel}`;
      if (subEl) subEl.textContent = `Abhi ${catLabel} category mein koi slide nahi hai. Edit mode on kar ke "Add Slide" se animation, video ya 3D model upload karein!`;
    }
    stopProjectSliderAutoplay();
    return;
  }

  if (currentProjectsViewMode === 'slider') {
    if (container) container.style.display = 'block';
    if (emptyCard) emptyCard.style.display = 'none';
  }

  renderCurrentProjectSlide();
  startProjectSliderAutoplay();
}

function renderCurrentProjectSlide() {
  if (!categorySlideProjects.length) return;

  if (currentProjectSlideIdx >= categorySlideProjects.length) currentProjectSlideIdx = 0;
  if (currentProjectSlideIdx < 0) currentProjectSlideIdx = categorySlideProjects.length - 1;

  const p = categorySlideProjects[currentProjectSlideIdx];
  if (!p) return;

  // Media elements
  const imgEl       = document.getElementById('sliderImg');
  const videoEl     = document.getElementById('sliderVideo');
  const glbEl       = document.getElementById('sliderGlb');
  const iframeEl    = document.getElementById('sliderIframe');
  const glbHint     = document.getElementById('sliderGlbHint');
  const badgeEl     = document.getElementById('sliderMediaBadge');
  const audioBtn    = document.getElementById('sliderAudioBtn');

  // Hide all initially
  if (imgEl)    imgEl.style.display = 'none';
  if (videoEl)  { videoEl.style.display = 'none'; videoEl.pause(); }
  if (glbEl)    glbEl.style.display = 'none';
  if (iframeEl) iframeEl.style.display = 'none';
  if (glbHint)  glbHint.style.display = 'none';
  if (audioBtn) audioBtn.style.display = 'none';

  const mediaSrc = p.src || p.url || p.thumbnail || '';
  const mediaType = (p.type || '').toLowerCase();

  // 1. 3D GLB Model
  if (mediaType === 'glb' || mediaSrc.match(/\.(glb|gltf)($|\?)/i)) {
    if (glbEl) {
      glbEl.src = mediaSrc;
      glbEl.style.display = 'block';
    }
    if (glbHint) glbHint.style.display = 'flex';
    if (badgeEl) badgeEl.innerHTML = '<i class="fas fa-cube"></i> <span>3D GLB MODEL</span>';
  }
  // 2. MP4 / WebM Native Video
  else if (mediaType === 'video' || mediaSrc.match(/\.(mp4|webm|mov)($|\?)/i)) {
    if (videoEl) {
      videoEl.src = mediaSrc;
      videoEl.muted = true;
      videoEl.style.display = 'block';
      videoEl.play().catch(() => {});
    }
    if (audioBtn) audioBtn.style.display = 'flex';
    if (badgeEl) badgeEl.innerHTML = '<i class="fas fa-film"></i> <span>MP4 VIDEO</span>';
  }
  // 3. YouTube / Vimeo Video Embed
  else if (mediaType === 'youtube' || mediaType === 'vimeo' || mediaSrc.includes('youtube.com') || mediaSrc.includes('vimeo.com')) {
    if (iframeEl) {
      let embedUrl = mediaSrc;
      if (mediaSrc.includes('watch?v=')) {
        embedUrl = mediaSrc.replace('watch?v=', 'embed/');
      }
      iframeEl.src = embedUrl;
      iframeEl.style.display = 'block';
    }
    if (badgeEl) badgeEl.innerHTML = '<i class="fab fa-youtube"></i> <span>VIDEO EMBED</span>';
  }
  // 4. Picture / High-Res Render
  else {
    if (imgEl) {
      imgEl.src = mediaSrc || 'https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=1200';
      imgEl.style.display = 'block';
    }
    if (badgeEl) badgeEl.innerHTML = '<i class="fas fa-image"></i> <span>4K RENDER</span>';
  }

  // Description & Details
  const catPillEl = document.getElementById('sliderCatPill');
  const counterEl = document.getElementById('sliderCounter');
  const titleEl   = document.getElementById('sliderTitle');
  const descEl    = document.getElementById('sliderDesc');
  const tagsWrap  = document.getElementById('sliderMetaTags');

  if (catPillEl) catPillEl.textContent = getCategoryLabel(p.category).toUpperCase();
  if (counterEl) {
    const cur = String(currentProjectSlideIdx + 1).padStart(2, '0');
    const tot = String(categorySlideProjects.length).padStart(2, '0');
    counterEl.textContent = `${cur} / ${tot}`;
  }
  if (titleEl) titleEl.textContent = p.title || 'Untitled Project';
  if (descEl)  descEl.textContent  = p.description || 'No description provided. Click "Edit Slide" in edit mode to add details.';

  // Render Tags
  if (tagsWrap) {
    tagsWrap.innerHTML = '';
    const tagsList = p.tags
      ? (Array.isArray(p.tags) ? p.tags : p.tags.split(',').map(t => t.trim()))
      : [getCategoryLabel(p.category), p.date ? p.date.slice(0,4) : '2026', 'Blender 4.x'];
    tagsList.forEach(t => {
      if (!t) return;
      const span = document.createElement('span');
      span.className = 'slider-tag';
      span.textContent = t;
      tagsWrap.appendChild(span);
    });
  }

  // Thumbnails Strip
  renderSliderThumbnails();
}

function renderSliderThumbnails() {
  const strip = document.getElementById('sliderThumbStrip');
  if (!strip) return;
  strip.innerHTML = '';

  categorySlideProjects.forEach((proj, idx) => {
    const thumbItem = document.createElement('div');
    thumbItem.className = 'slider-thumb-item' + (idx === currentProjectSlideIdx ? ' active' : '');
    const thumbUrl = proj.thumbnail || proj.src || 'https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=200';
    const isVid = ['video', 'youtube', 'vimeo'].includes(proj.type);
    const isGlb = proj.type === 'glb';

    thumbItem.innerHTML = `
      <img src="${thumbUrl}" alt="${proj.title}" onerror="this.src='https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=200'" />
      ${isVid ? '<span class="thumb-type-icon"><i class="fas fa-play"></i></span>' : ''}
      ${isGlb ? '<span class="thumb-type-icon"><i class="fas fa-cube"></i></span>' : ''}
    `;

    thumbItem.addEventListener('click', (e) => {
      e.stopPropagation();
      selectProjectSlide(idx);
    });
    strip.appendChild(thumbItem);
  });

  // Auto-scroll active thumb inside the strip container ONLY (never scroll window)
  const activeEl = strip.children[currentProjectSlideIdx];
  if (activeEl && strip) {
    const targetScroll = activeEl.offsetLeft - (strip.clientWidth - activeEl.clientWidth) / 2;
    strip.scrollTo({ left: targetScroll, behavior: 'smooth' });
  }
}

function nextProjectSlide() {
  if (!categorySlideProjects.length) return;
  currentProjectSlideIdx = (currentProjectSlideIdx + 1) % categorySlideProjects.length;
  renderCurrentProjectSlide();
  resetProgressTrack();
}

function prevProjectSlide() {
  if (!categorySlideProjects.length) return;
  currentProjectSlideIdx = (currentProjectSlideIdx - 1 + categorySlideProjects.length) % categorySlideProjects.length;
  renderCurrentProjectSlide();
  resetProgressTrack();
}

function selectProjectSlide(idx) {
  if (idx < 0 || idx >= categorySlideProjects.length) return;
  currentProjectSlideIdx = idx;
  renderCurrentProjectSlide();
  resetProgressTrack();
}

// 5s Auto-Slide Timer & Progress Bar
function startProjectSliderAutoplay() {
  stopProjectSliderAutoplay();
  if (categorySlideProjects.length <= 1) return;

  projectSliderStartTime = Date.now();
  const progressBar = document.getElementById('sliderProgressBar');

  projectSliderProgressTimer = setInterval(() => {
    if (isProjectSliderPaused) {
      projectSliderStartTime += 50; // pause progress
      return;
    }
    const elapsed = Date.now() - projectSliderStartTime;
    const pct = Math.min(100, (elapsed / PROJECT_SLIDE_DURATION) * 100);
    if (progressBar) progressBar.style.width = pct + '%';

    if (elapsed >= PROJECT_SLIDE_DURATION) {
      projectSliderStartTime = Date.now();
      if (progressBar) progressBar.style.width = '0%';
      nextProjectSlide();
    }
  }, 50);
}

function stopProjectSliderAutoplay() {
  if (projectSliderProgressTimer) {
    clearInterval(projectSliderProgressTimer);
    projectSliderProgressTimer = null;
  }
  const progressBar = document.getElementById('sliderProgressBar');
  if (progressBar) progressBar.style.width = '0%';
}

function resetProgressTrack() {
  projectSliderStartTime = Date.now();
  const progressBar = document.getElementById('sliderProgressBar');
  if (progressBar) progressBar.style.width = '0%';
}

function pauseProjectSlider(pause) {
  isProjectSliderPaused = pause;
  const pill = document.getElementById('sliderAutoPill');
  const icon = document.getElementById('sliderAutoIcon');
  const text = document.getElementById('sliderAutoText');
  if (pill) {
    pill.classList.toggle('paused', pause);
    if (icon) icon.className = pause ? 'fas fa-pause' : 'fas fa-rotate';
    if (text) text.textContent = pause ? 'PAUSED' : '5s AUTO';
  }
}

function toggleProjectSliderAutoplay() {
  pauseProjectSlider(!isProjectSliderPaused);
}

function toggleSlideVideoAudio() {
  const videoEl = document.getElementById('sliderVideo');
  const icon = document.getElementById('sliderAudioIcon');
  if (!videoEl) return;
  videoEl.muted = !videoEl.muted;
  if (icon) {
    icon.className = videoEl.muted ? 'fas fa-volume-mute' : 'fas fa-volume-up';
  }
}

// View Mode Toggle (Slider vs Grid)
function switchProjectsView(mode) {
  currentProjectsViewMode = mode;
  const sliderWrap = document.getElementById('projectsSliderContainer');
  const gridWrap   = document.getElementById('gallery-grid');
  const loadMore   = document.getElementById('load-more-wrap');
  const emptyCard  = document.getElementById('sliderEmptyCard');

  const btnSlider  = document.getElementById('viewBtnSlider');
  const btnGrid    = document.getElementById('viewBtnGrid');

  if (btnSlider) btnSlider.classList.toggle('active', mode === 'slider');
  if (btnGrid)   btnGrid.classList.toggle('active', mode === 'grid');

  if (mode === 'slider') {
    if (categorySlideProjects.length > 0) {
      if (sliderWrap) sliderWrap.style.display = 'block';
      if (emptyCard)  emptyCard.style.display = 'none';
      startProjectSliderAutoplay();
    } else {
      if (sliderWrap) sliderWrap.style.display = 'none';
      if (emptyCard)  emptyCard.style.display = 'block';
    }
    if (gridWrap) gridWrap.style.display = 'none';
    if (loadMore) loadMore.style.display = 'none';
  } else {
    stopProjectSliderAutoplay();
    if (sliderWrap) sliderWrap.style.display = 'none';
    if (emptyCard)  emptyCard.style.display = 'none';
    if (gridWrap)   gridWrap.style.display = '';
    renderGallery();
  }
}

function openCurrentSlideLightbox() {
  if (!categorySlideProjects.length) return;
  const curProject = categorySlideProjects[currentProjectSlideIdx];
  const allProjects = getProjects();
  let targetIdx = allProjects.findIndex(p => p.id === curProject.id);
  if (targetIdx === -1) targetIdx = 0;
  filteredProjects = allProjects;
  openLightbox(targetIdx);
}

// ============================================================
// ADD / EDIT / DELETE PROJECT SLIDE MODAL
// ============================================================

function openAddProjectModal() {
  pendingSlideMedia = null;
  const modal = document.getElementById('projectSlideModal');
  const heading = document.getElementById('modalProjectHeading');
  if (heading) heading.innerHTML = '<i class="fas fa-layer-group"></i> Add Project Slide';

  document.getElementById('pSlideId').value = '';
  document.getElementById('pSlideTitle').value = '';
  document.getElementById('pSlideDesc').value = '';
  document.getElementById('pSlideUrl').value = '';
  document.getElementById('pSlideTags').value = '';
  document.getElementById('pSlideFile').value = '';

  const catSelect = document.getElementById('pSlideCategory');
  if (catSelect) {
    catSelect.value = (activeSlideCategory === 'all') ? 'architecture' : activeSlideCategory;
  }
  const typeSelect = document.getElementById('pSlideType');
  if (typeSelect) {
    typeSelect.value = 'image';
    onSlideMediaTypeChange('image');
  }

  const previewBox = document.getElementById('pSlidePreviewBox');
  if (previewBox) previewBox.style.display = 'none';

  if (modal) {
    modal.classList.add('open');
    modal.style.display = 'flex';
  }
}

function openEditCurrentProjectModal() {
  if (!categorySlideProjects.length) return;
  const p = categorySlideProjects[currentProjectSlideIdx];
  if (!p) return;

  pendingSlideMedia = null;
  const modal = document.getElementById('projectSlideModal');
  const heading = document.getElementById('modalProjectHeading');
  if (heading) heading.innerHTML = '<i class="fas fa-pen"></i> Edit Project Slide';

  document.getElementById('pSlideId').value    = p.id || '';
  document.getElementById('pSlideTitle').value = p.title || '';
  document.getElementById('pSlideDesc').value  = p.description || '';
  document.getElementById('pSlideUrl').value   = p.src || '';
  document.getElementById('pSlideTags').value  = Array.isArray(p.tags) ? p.tags.join(', ') : (p.tags || '');
  document.getElementById('pSlideFile').value  = '';

  const catSelect = document.getElementById('pSlideCategory');
  if (catSelect) catSelect.value = p.category || 'architecture';

  const typeSelect = document.getElementById('pSlideType');
  if (typeSelect) {
    typeSelect.value = p.type || 'image';
    onSlideMediaTypeChange(p.type || 'image');
  }

  // Show existing media preview
  const previewBox = document.getElementById('pSlidePreviewBox');
  const previewCont = document.getElementById('pSlidePreviewContent');
  if (previewBox && previewCont && (p.src || p.thumbnail)) {
    previewBox.style.display = 'block';
    const src = p.src || p.thumbnail;
    if (p.type === 'video') {
      previewCont.innerHTML = `<video src="${src}" autoplay muted loop style="max-height:180px; max-width:100%; border-radius:8px;"></video>`;
    } else if (p.type === 'glb') {
      previewCont.innerHTML = `<model-viewer src="${src}" auto-rotate camera-controls style="width:200px; height:180px;"></model-viewer>`;
    } else {
      previewCont.innerHTML = `<img src="${src}" style="max-height:180px; max-width:100%; border-radius:8px; object-fit:cover;" />`;
    }
  }

  if (modal) {
    modal.classList.add('open');
    modal.style.display = 'flex';
  }
}

function closeProjectSlideModal() {
  const modal = document.getElementById('projectSlideModal');
  if (modal) {
    modal.classList.remove('open');
    modal.style.display = 'none';
  }
}

function onSlideMediaTypeChange(type) {
  const fileInput = document.getElementById('pSlideFile');
  const uploadLabel = document.getElementById('pSlideUploadLabel');
  if (!fileInput) return;

  if (type === 'image') {
    fileInput.accept = 'image/*';
    if (uploadLabel) uploadLabel.textContent = 'Upload Picture (JPG / PNG / WebP)';
  } else if (type === 'video') {
    fileInput.accept = 'video/mp4,video/webm';
    if (uploadLabel) uploadLabel.textContent = 'Upload MP4 / WebM Video';
  } else if (type === 'glb') {
    fileInput.accept = '.glb,.gltf';
    if (uploadLabel) uploadLabel.textContent = 'Upload 3D Model (.glb / .gltf)';
  } else {
    fileInput.accept = '*';
    if (uploadLabel) uploadLabel.textContent = 'Upload Optional Thumbnail File';
  }
}

// Client-side image compressor for project slides
function compressSlideImage(file, maxDimension = 1280, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        if (w > maxDimension || h > maxDimension) {
          if (w > h) {
            h = Math.round((h * maxDimension) / w);
            w = maxDimension;
          } else {
            w = Math.round((w * maxDimension) / h);
            h = maxDimension;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handleSlideFileSelect(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const type = document.getElementById('pSlideType').value;
  const previewBox = document.getElementById('pSlidePreviewBox');
  const previewCont = document.getElementById('pSlidePreviewContent');

  showToast('⏳ File process ho rahi hai...');

  try {
    if (type === 'image') {
      const compressedUrl = await compressSlideImage(file);
      pendingSlideMedia = { type: 'image', url: compressedUrl, file: file };
      if (previewBox && previewCont) {
        previewBox.style.display = 'block';
        previewCont.innerHTML = `<img src="${compressedUrl}" style="max-height:180px; max-width:100%; border-radius:8px; object-fit:cover;" />`;
      }
    } else if (type === 'video') {
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target.result;
        pendingSlideMedia = { type: 'video', url: dataUrl, file: file };
        if (previewBox && previewCont) {
          previewBox.style.display = 'block';
          previewCont.innerHTML = `<video src="${dataUrl}" autoplay muted loop style="max-height:180px; max-width:100%; border-radius:8px;"></video>`;
        }
      };
      reader.readAsDataURL(file);
    } else if (type === 'glb') {
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target.result;
        pendingSlideMedia = { type: 'glb', url: dataUrl, file: file };
        if (previewBox && previewCont) {
          previewBox.style.display = 'block';
          previewCont.innerHTML = `<model-viewer src="${dataUrl}" auto-rotate camera-controls style="width:200px; height:180px;"></model-viewer>`;
        }
      };
      reader.readAsDataURL(file);
    }
    showToast('✅ File preview tayyar hai!');
  } catch(err) {
    console.error('Slide file select error:', err);
    showToast('❌ File load karne mein masla hua: ' + err.message, 'error');
  }
}

function handleSlideUrlInput(url) {
  if (!url || !url.startsWith('http')) return;
  const previewBox = document.getElementById('pSlidePreviewBox');
  const previewCont = document.getElementById('pSlidePreviewContent');
  const type = document.getElementById('pSlideType').value;

  if (previewBox && previewCont) {
    previewBox.style.display = 'block';
    if (type === 'video') {
      previewCont.innerHTML = `<video src="${url}" autoplay muted loop style="max-height:180px; max-width:100%; border-radius:8px;"></video>`;
    } else if (type === 'glb') {
      previewCont.innerHTML = `<model-viewer src="${url}" auto-rotate camera-controls style="width:200px; height:180px;"></model-viewer>`;
    } else {
      previewCont.innerHTML = `<img src="${url}" style="max-height:180px; max-width:100%; border-radius:8px; object-fit:cover;" />`;
    }
  }
}

async function handleSaveProjectSlide(e) {
  e.preventDefault();

  const idVal    = document.getElementById('pSlideId').value.trim();
  const title    = document.getElementById('pSlideTitle').value.trim();
  const category = document.getElementById('pSlideCategory').value;
  const type     = document.getElementById('pSlideType').value;
  const desc     = document.getElementById('pSlideDesc').value.trim();
  const tagsStr  = document.getElementById('pSlideTags').value.trim();
  const urlVal   = document.getElementById('pSlideUrl').value.trim();

  let finalSrc = urlVal;
  let finalThumb = urlVal;

  if (pendingSlideMedia && pendingSlideMedia.url) {
    finalSrc = pendingSlideMedia.url;
    finalThumb = (type === 'image') ? pendingSlideMedia.url : urlVal;
  }

  if (!finalSrc && !idVal) {
    showToast('⚠️ Barahe karam image/video/GLB file choose karein ya link enter karein!', 'error');
    return;
  }

  const tagsArr = tagsStr ? tagsStr.split(',').map(s => s.trim()).filter(Boolean) : [];
  const allProjects = [...getProjects()];

  // Editing existing project
  if (idVal) {
    const existingIdx = allProjects.findIndex(p => p.id === idVal);
    if (existingIdx !== -1) {
      allProjects[existingIdx] = {
        ...allProjects[existingIdx],
        title,
        category,
        type,
        src: finalSrc || allProjects[existingIdx].src,
        thumbnail: finalThumb || allProjects[existingIdx].thumbnail || finalSrc || allProjects[existingIdx].src,
        description: desc,
        tags: tagsArr.length ? tagsArr : allProjects[existingIdx].tags,
      };
      showToast('✅ Slide update ho gayi!');
    }
  } else {
    // Creating new project slide
    const newProj = {
      id: 'proj_' + Date.now(),
      title,
      category,
      type,
      src: finalSrc,
      thumbnail: finalThumb || finalSrc,
      description: desc,
      tags: tagsArr,
      featured: true,
      date: new Date().toISOString().split('T')[0]
    };
    allProjects.unshift(newProj);
    showToast('🎉 Nayi Slide kamyabi se add ho gayi!');
  }

  saveProjects(allProjects);
  closeProjectSlideModal();

  // Switch category and display the slide
  switchProjectCategory(category);
  selectProjectSlide(0);
}

function deleteCurrentProjectSlide() {
  if (!categorySlideProjects.length) return;
  const cur = categorySlideProjects[currentProjectSlideIdx];
  if (!cur) return;

  if (!confirm(`Aap waqai "${cur.title || 'is project'}" ko delete karna chahte hain?`)) return;

  const allProjects = getProjects().filter(p => p.id !== cur.id);
  saveProjects(allProjects);
  showToast('🗑️ Slide delete ho gayi!');

  switchProjectCategory(activeSlideCategory);
}


/* ============================================================
   SITE TEXT & PAGE SCALE CONTROLLER (v22.5)
   Allows scaling text & UI up / down (80% to 140%)
   ============================================================ */

let currentSiteScale = 1.0;

function initSiteScale() {
  try {
    const savedScale = parseFloat(localStorage.getItem('site_text_scale') || '1.0');
    if (!isNaN(savedScale) && savedScale >= 0.8 && savedScale <= 1.5) {
      currentSiteScale = savedScale;
    }
  } catch (e) {}
  applySiteScale(currentSiteScale, false);
}

function applySiteScale(scale, save = true) {
  currentSiteScale = Math.round(scale * 10) / 10;
  if (currentSiteScale < 0.8) currentSiteScale = 0.8;
  if (currentSiteScale > 1.4) currentSiteScale = 1.4;

  const basePx = Math.round(16.5 * currentSiteScale);
  document.documentElement.style.fontSize = basePx + 'px';
  document.documentElement.style.setProperty('--site-scale', currentSiteScale);

  const label = document.getElementById('siteScaleLabel');
  if (label) {
    label.textContent = Math.round(currentSiteScale * 100) + '%';
  }

  if (save) {
    try {
      localStorage.setItem('site_text_scale', currentSiteScale.toString());
      showToast(`🔍 Website Scale: ${Math.round(currentSiteScale * 100)}%`);
    } catch (e) {}
  }
}

function changeSiteScale(delta) {
  applySiteScale(currentSiteScale + delta, true);
}

function resetSiteScale() {
  applySiteScale(1.0, true);
}

// Initialize scale immediately and on DOMContentLoaded
initSiteScale();
window.addEventListener('DOMContentLoaded', initSiteScale);


/* ============================================================
   DIRECT WHATSAPP APP & INQUIRIES MANAGEMENT (v22.6)
   ============================================================ */

function openDirectWhatsApp(phone, text = '') {
  const clean = (phone || '923392332272').replace(/[^0-9]/g, '');
  const encoded = text ? encodeURIComponent(text) : '';
  const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 768;

  if (isMobile) {
    // Direct mobile app deep link — launches native WhatsApp application instantly!
    const mobileUrl = encoded
      ? `https://api.whatsapp.com/send?phone=${clean}&text=${encoded}`
      : `https://api.whatsapp.com/send?phone=${clean}`;
    window.location.href = mobileUrl;
  } else {
    // Desktop: opens WhatsApp Web or Desktop App
    const desktopUrl = encoded
      ? `https://web.whatsapp.com/send?phone=${clean}&text=${encoded}`
      : `https://web.whatsapp.com/send?phone=${clean}`;
    window.open(desktopUrl, '_blank', 'noopener,noreferrer');
  }
  showToast('📲 WhatsApp khul raha hai...');
}

function handleWhatsAppLinkClick(event, phone) {
  const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 768;
  if (isMobile) {
    event.preventDefault();
    openDirectWhatsApp(phone, 'Hello Design Corner! I visited your portfolio website and would like to discuss a project.');
  }
}

// Inquiries Local Storage Engine
function getLocalInquiries() {
  try {
    return JSON.parse(localStorage.getItem('portfolio_client_inquiries') || '[]');
  } catch(e) {
    return [];
  }
}

function saveInquiryLocally(inquiry) {
  try {
    const list = getLocalInquiries();
    list.unshift(inquiry);
    localStorage.setItem('portfolio_client_inquiries', JSON.stringify(list));
    updateInquiryBadge();
  } catch(e) {
    console.warn('Could not save inquiry locally:', e);
  }
}

function updateInquiryBadge() {
  const badge = document.getElementById('inquiryCount');
  if (badge) {
    const list = getLocalInquiries();
    badge.textContent = list.length;
  }
}

function openInquiriesModal() {
  const modal = document.getElementById('inquiriesModal');
  const listEl = document.getElementById('inquiriesList');
  if (!modal || !listEl) return;

  const inquiries = getLocalInquiries();
  if (!inquiries.length) {
    listEl.innerHTML = `
      <div style="text-align:center; padding:2.5rem 1rem; color:var(--text-muted);">
        <i class="fas fa-inbox" style="font-size:2.5rem; color:rgba(0,240,255,0.3); margin-bottom:0.8rem;"></i>
        <h4 style="color:#fff; margin-bottom:0.4rem;">Koi message nahi mila</h4>
        <p style="font-size:0.82rem;">Website form se submit hone walay messages yahan display hotay hain.</p>
      </div>
    `;
  } else {
    listEl.innerHTML = inquiries.map((inq, idx) => `
      <div style="background:rgba(16,20,48,0.7); border:1px solid rgba(0,240,255,0.25); border-radius:12px; padding:1.2rem; margin-bottom:0.8rem;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem; flex-wrap:wrap; gap:0.4rem;">
          <strong style="color:#fff; font-size:0.95rem;">👤 ${inq.name}</strong>
          <span style="font-size:0.72rem; color:#00f0ff; background:rgba(0,240,255,0.1); border:1px solid rgba(0,240,255,0.3); border-radius:50px; padding:2px 8px;">${inq.service || 'General'}</span>
        </div>
        <div style="font-size:0.82rem; color:rgba(255,255,255,0.75); margin-bottom:0.5rem;">
          <a href="mailto:${inq.email}" style="color:#a855f7;"><i class="fas fa-envelope"></i> ${inq.email}</a>
          <span style="margin:0 6px; color:rgba(255,255,255,0.3);">•</span>
          <span style="color:var(--text-muted);"><i class="fas fa-clock"></i> ${inq.date || 'Recent'}</span>
        </div>
        <div style="font-size:0.85rem; line-height:1.5; color:#fff; background:rgba(0,0,0,0.3); padding:0.8rem; border-radius:8px; border-left:3px solid #00f0ff;">
          ${(inq.message || '').replace(/\n/g, '<br/>')}
        </div>
        <div style="margin-top:0.6rem; text-align:right;">
          <button type="button" onclick="replyViaWhatsAppDirect('${inq.name}', '${inq.message}')" style="background:linear-gradient(135deg,#10b981,#059669); color:#fff; border:none; border-radius:50px; padding:4px 12px; font-size:0.75rem; font-weight:700; cursor:pointer;">
            <i class="fab fa-whatsapp"></i> WhatsApp Reply
          </button>
        </div>
      </div>
    `).join('');
  }

  modal.style.display = 'flex';
  updateInquiryBadge();
}

function closeInquiriesModal() {
  const modal = document.getElementById('inquiriesModal');
  if (modal) modal.style.display = 'none';
}

function clearAllInquiries() {
  if (!confirm('Kya aap tamam inquiries delete karna chahte hain?')) return;
  localStorage.removeItem('portfolio_client_inquiries');
  updateInquiryBadge();
  openInquiriesModal();
  showToast('🗑️ Inquiries clear ho gayin!');
}

function replyViaWhatsAppDirect(name, clientMsg) {
  const msg = `Hello ${name}! Thank you for contacting Design Corner. Regarding your message: "${clientMsg.slice(0, 80)}..."`;
  openDirectWhatsApp('+923392332272', msg);
}

// Initial badge check
window.addEventListener('DOMContentLoaded', updateInquiryBadge);
