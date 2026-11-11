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
  if (typeof getAddons === 'function') updatedJson.addons = getAddons();
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

  // Direct WhatsApp Button
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

      window.open(`https://web.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(waMsg)}`, '_blank');
      showToast('📲 WhatsApp chat khul rahi hai...');
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
      el.href = 'https://web.whatsapp.com/send?phone=923392332272';
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

function renderAddons() {
  const grid = document.getElementById('addonsGrid');
  if (!grid) return;
  const addons = getAddons();

  grid.innerHTML = addons.map(addon => {
    const isEdit = editMode;
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
          <p class="addon-desc">${addon.desc || ''}</p>
        </div>
        <div class="addon-card-bottom">
          <div class="addon-downloads-stat">
            <i class="fas fa-download"></i> ${addon.downloads || 'Free'}
          </div>
          <div style="display:flex;align-items:center;gap:.6rem;">
            <div class="addon-edit-actions">
              <button class="btn-addon-action" onclick="openAddonModal('${addon.id}')" title="Edit Addon"><i class="fas fa-pen"></i></button>
              <button class="btn-addon-action del" onclick="deleteAddon('${addon.id}')" title="Delete Addon"><i class="fas fa-trash"></i></button>
            </div>
            <a ${downloadAction} class="btn-addon-download">
              <i class="fas fa-cloud-arrow-down"></i> Download
            </a>
          </div>
        </div>
      </div>
    `;
  }).join('');
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
