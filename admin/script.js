/* ========================================================
   ADMIN CMS SCRIPT — GITHUB API INTEGRATION
   Allows user to add/edit/delete projects, upload media,
   and commit directly to GitHub repository.
   ======================================================== */

const REPO_OWNER = 'designcorner488';
const REPO_NAME  = 'designcorner488.github.io';
const BRANCH     = 'master';
const DATA_FILE  = 'portfolio.json';

// Local Storage Keys
const KEY_PASS   = 'cms_admin_password';
const KEY_TOKEN  = 'cms_gh_token';
const KEY_AUTH   = 'cms_session_auth';

let portfolioState = {
  settings: {},
  categories: [],
  projects: []
};
let fileSha = null;
let currentDeletingId = null;
let uploadedFileBase64 = null;
let uploadedFileName = null;

// ---- INITIALIZATION ----
document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  initNavigation();
  initFormInteractivity();
});

// ---- AUTHENTICATION & LOGIN ----
function initAuth() {
  const loginScreen = document.getElementById('login-screen');
  const setupScreen = document.getElementById('setup-screen');
  const adminPanel  = document.getElementById('admin-panel');
  const loginForm   = document.getElementById('login-form');
  const loginPass   = document.getElementById('login-pass');
  const loginError  = document.getElementById('login-error');
  const saveTokBtn  = document.getElementById('save-token-btn');
  const ghTokenInput= document.getElementById('gh-token');
  const logoutBtn   = document.getElementById('logout-btn');

  // Check if session is already active
  const isAuth = sessionStorage.getItem(KEY_AUTH) === 'true';
  const savedPass = localStorage.getItem(KEY_PASS) || 'admin123';
  const savedToken = localStorage.getItem(KEY_TOKEN);

  if (isAuth) {
    if (!savedToken) {
      loginScreen.style.display = 'none';
      setupScreen.style.display = 'flex';
      adminPanel.style.display = 'none';
    } else {
      loginScreen.style.display = 'none';
      setupScreen.style.display = 'none';
      adminPanel.style.display = 'flex';
      loadPortfolioFromGitHub();
    }
  }

  // Handle Login Submit
  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const entered = loginPass.value.trim();
    if (entered === savedPass) {
      sessionStorage.setItem(KEY_AUTH, 'true');
      loginError.style.display = 'none';
      
      const token = localStorage.getItem(KEY_TOKEN);
      if (!token) {
        loginScreen.style.display = 'none';
        setupScreen.style.display = 'flex';
      } else {
        loginScreen.style.display = 'none';
        adminPanel.style.display = 'flex';
        loadPortfolioFromGitHub();
      }
    } else {
      loginError.style.display = 'block';
      loginPass.value = '';
    }
  });

  // Handle Setup Token Save
  saveTokBtn.addEventListener('click', async () => {
    const token = ghTokenInput.value.trim();
    const tokenErr = document.getElementById('token-error');
    if (!token || token.length < 10) {
      tokenErr.textContent = 'Please enter a valid GitHub token';
      tokenErr.style.display = 'block';
      return;
    }

    saveTokBtn.disabled = true;
    saveTokBtn.textContent = 'Verifying token with GitHub...';
    tokenErr.style.display = 'none';

    try {
      // Validate token with GitHub API
      const res = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) {
        throw new Error('Could not access repository with this token. Please ensure "repo" scope is enabled.');
      }

      localStorage.setItem(KEY_TOKEN, token);
      setupScreen.style.display = 'none';
      adminPanel.style.display = 'flex';
      showToast('GitHub token verified successfully!', 'success');
      loadPortfolioFromGitHub();
    } catch (err) {
      tokenErr.textContent = err.message || 'Token verification failed';
      tokenErr.style.display = 'block';
    } finally {
      saveTokBtn.disabled = false;
      saveTokBtn.textContent = 'Save Token & Continue →';
    }
  });

  // Handle Logout
  logoutBtn.addEventListener('click', () => {
    sessionStorage.removeItem(KEY_AUTH);
    location.reload();
  });
}

// ---- NAVIGATION ----
function initNavigation() {
  const links = document.querySelectorAll('.sb-nav .sb-link');
  const views = document.querySelectorAll('.view');

  links.forEach(link => {
    link.addEventListener('click', () => {
      const targetView = link.dataset.view;
      switchView(targetView);
    });
  });

  // Shortcut buttons
  document.getElementById('dash-add-btn')?.addEventListener('click', () => switchView('add-project'));
  document.getElementById('proj-add-btn')?.addEventListener('click', () => switchView('add-project'));
  document.getElementById('cancel-form-btn')?.addEventListener('click', () => switchView('projects'));
  document.getElementById('cancel-form-btn-2')?.addEventListener('click', () => switchView('projects'));
}

function switchView(viewName) {
  document.querySelectorAll('.sb-nav .sb-link').forEach(l => {
    l.classList.toggle('active', l.dataset.view === viewName);
  });
  document.querySelectorAll('.view').forEach(v => {
    v.classList.toggle('active', v.id === `view-${viewName}`);
  });

  if (viewName === 'add-project') {
    resetProjectForm();
  }
}

// ---- FETCH DATA FROM GITHUB ----
async function loadPortfolioFromGitHub() {
  const token = localStorage.getItem(KEY_TOKEN);
  const table = document.getElementById('projects-table');
  table.innerHTML = '<div class="table-loading">Syncing with GitHub repository...</div>';

  try {
    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${DATA_FILE}?ref=${BRANCH}&t=${Date.now()}`;
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (!res.ok) throw new Error(`GitHub API Error: ${res.statusText}`);
    const data = await res.json();
    fileSha = data.sha;

    // Decode base64 utf-8 content
    const decodedContent = decodeURIComponent(escape(atob(data.content.replace(/\s/g, ''))));
    portfolioState = JSON.parse(decodedContent);

    renderDashboard();
    renderProjectsTable('all');
    populateSettingsForm();
    populateCategoryDropdowns();
  } catch (err) {
    console.error('Error loading portfolio:', err);
    table.innerHTML = `<div class="table-empty">Error loading data: ${err.message}. Check your token in Settings.</div>`;
    showToast('Failed to load portfolio: ' + err.message, 'error');
  }
}

// ---- RENDER DASHBOARD ----
function renderDashboard() {
  const projects = portfolioState.projects || [];
  const total = projects.length;
  const images = projects.filter(p => !p.type || p.type === 'image').length;
  const videos = projects.filter(p => p.type === 'video' || p.type === 'youtube' || p.type === 'vimeo').length;
  const featured = projects.filter(p => p.featured).length;

  document.getElementById('dash-total').textContent = total;
  document.getElementById('dash-images').textContent = images;
  document.getElementById('dash-videos').textContent = videos;
  document.getElementById('dash-featured').textContent = featured;

  // Recent cards
  const recentGrid = document.getElementById('recent-grid');
  recentGrid.innerHTML = '';
  const recentItems = [...projects].reverse().slice(0, 6);

  if (!recentItems.length) {
    recentGrid.innerHTML = '<p style="color:var(--white-40);font-size:0.85rem;">No projects added yet.</p>';
    return;
  }

  recentItems.forEach(p => {
    const card = document.createElement('div');
    card.className = 'recent-card';
    const thumb = p.thumbnail || p.src;
    card.innerHTML = `
      <div class="rc-thumb">
        ${thumb ? `<img src="${thumb}" alt="${p.title}"/>` : '📁'}
      </div>
      <div class="rc-info">
        <div class="rc-title" title="${p.title}">${p.title}</div>
        <div class="rc-cat">${p.category}</div>
      </div>
    `;
    card.addEventListener('click', () => editProject(p.id));
    recentGrid.appendChild(card);
  });
}

// ---- CATEGORY DROPDOWNS ----
function populateCategoryDropdowns() {
  const cats = portfolioState.categories || [];
  const filterCat = document.getElementById('proj-filter-cat');
  filterCat.innerHTML = '<option value="all">All Categories</option>';
  
  const formCat = document.getElementById('p-category');
  formCat.innerHTML = '<option value="">Select Category</option>';

  cats.forEach(c => {
    if (c.id !== 'all') {
      const opt1 = document.createElement('option');
      opt1.value = c.id;
      opt1.textContent = c.label;
      filterCat.appendChild(opt1);

      const opt2 = document.createElement('option');
      opt2.value = c.id;
      opt2.textContent = c.label;
      formCat.appendChild(opt2);
    }
  });

  filterCat.onchange = () => renderProjectsTable(filterCat.value);
}

// ---- RENDER PROJECTS TABLE ----
function renderProjectsTable(catFilter = 'all') {
  const table = document.getElementById('projects-table');
  let list = portfolioState.projects || [];
  if (catFilter !== 'all') {
    list = list.filter(p => p.category === catFilter);
  }

  if (!list.length) {
    table.innerHTML = '<div class="table-empty">No projects found in this category. Click "+ Add Project" to create one.</div>';
    return;
  }

  table.innerHTML = `
    <div class="table-row header">
      <div>Thumb</div>
      <div>Title</div>
      <div>Category</div>
      <div>Type</div>
      <div>Featured</div>
      <div style="text-align:right">Actions</div>
    </div>
  `;

  list.forEach(p => {
    const row = document.createElement('div');
    row.className = 'table-row';
    const thumb = p.thumbnail || p.src;
    row.innerHTML = `
      <div class="tr-thumb">
        ${thumb ? `<img src="${thumb}" alt="${p.title}"/>` : '🖼️'}
      </div>
      <div class="tr-title" title="${p.title}">${p.title}</div>
      <div><span class="tr-cat">${p.category}</span></div>
      <div class="tr-type">${p.type || 'image'}</div>
      <div class="tr-featured">${p.featured ? '⭐ Yes' : '—'}</div>
      <div class="tr-actions">
        <button class="btn-icon edit" title="Edit">✏️</button>
        <button class="btn-icon delete" title="Delete">🗑️</button>
      </div>
    `;

    row.querySelector('.edit').addEventListener('click', () => editProject(p.id));
    row.querySelector('.delete').addEventListener('click', () => promptDelete(p.id, p.title));
    table.appendChild(row);
  });
}

// ---- FORM INTERACTIVITY & MEDIA SWITCHING ----
function initFormInteractivity() {
  const typeSelect = document.getElementById('p-type');
  const imgZone = document.getElementById('image-upload-zone');
  const imgInput = document.getElementById('image-file-input');
  const vidZone = document.getElementById('video-upload-zone');
  const vidInput = document.getElementById('video-file-input');
  const removeImgBtn = document.getElementById('remove-image');

  typeSelect.addEventListener('change', () => {
    const val = typeSelect.value;
    document.getElementById('media-image').style.display = val === 'image' ? 'flex' : 'none';
    document.getElementById('media-youtube').style.display = val === 'youtube' ? 'flex' : 'none';
    document.getElementById('media-vimeo').style.display = val === 'vimeo' ? 'flex' : 'none';
    document.getElementById('media-video').style.display = val === 'video' ? 'flex' : 'none';
  });

  // Image Upload Click & Drag
  imgZone.addEventListener('click', () => imgInput.click());
  imgZone.addEventListener('dragover', (e) => { e.preventDefault(); imgZone.classList.add('drag-over'); });
  imgZone.addEventListener('dragleave', () => imgZone.classList.remove('drag-over'));
  imgZone.addEventListener('drop', (e) => {
    e.preventDefault();
    imgZone.classList.remove('drag-over');
    if (e.dataTransfer.files.length) handleImageFile(e.dataTransfer.files[0]);
  });
  imgInput.addEventListener('change', () => {
    if (imgInput.files.length) handleImageFile(imgInput.files[0]);
  });

  removeImgBtn.addEventListener('click', () => {
    uploadedFileBase64 = null;
    uploadedFileName = null;
    document.getElementById('image-preview').style.display = 'none';
    document.getElementById('image-upload-zone').style.display = 'block';
    document.getElementById('p-img-url').value = '';
  });

  // Video Upload Click & Drag
  vidZone.addEventListener('click', () => vidInput.click());
  vidZone.addEventListener('dragover', (e) => { e.preventDefault(); vidZone.classList.add('drag-over'); });
  vidZone.addEventListener('dragleave', () => vidZone.classList.remove('drag-over'));
  vidZone.addEventListener('drop', (e) => {
    e.preventDefault();
    vidZone.classList.remove('drag-over');
    if (e.dataTransfer.files.length) handleVideoFile(e.dataTransfer.files[0]);
  });
  vidInput.addEventListener('change', () => {
    if (vidInput.files.length) handleVideoFile(vidInput.files[0]);
  });

  // Project Form Submit
  document.getElementById('project-form').addEventListener('submit', handleProjectSave);

  // Settings Form Submit
  document.getElementById('settings-form').addEventListener('submit', handleSettingsSave);

  // Modal Cancel
  document.getElementById('modal-cancel').addEventListener('click', () => {
    document.getElementById('confirm-modal').style.display = 'none';
    currentDeletingId = null;
  });
  document.getElementById('modal-confirm').addEventListener('click', executeDelete);
}

function handleImageFile(file) {
  if (!file.type.startsWith('image/')) {
    showToast('Please select a valid image file (JPG, PNG, WebP)', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    uploadedFileBase64 = e.target.result.split(',')[1];
    uploadedFileName = `images/${Date.now()}-${file.name.replace(/\s+/g, '_')}`;

    document.getElementById('preview-img').src = e.target.result;
    document.getElementById('image-preview').style.display = 'block';
    document.getElementById('image-upload-zone').style.display = 'none';
  };
  reader.readAsDataURL(file);
}

function handleVideoFile(file) {
  if (file.size > 25 * 1024 * 1024) {
    showToast('Video size exceeds 25MB GitHub limit. For large animations, upload to YouTube or Vimeo and use their link!', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    uploadedFileBase64 = e.target.result.split(',')[1];
    uploadedFileName = `videos/${Date.now()}-${file.name.replace(/\s+/g, '_')}`;

    const nameDisp = document.getElementById('video-name');
    nameDisp.textContent = `Selected: ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`;
    nameDisp.style.display = 'block';
  };
  reader.readAsDataURL(file);
}

// ---- RESET PROJECT FORM ----
function resetProjectForm() {
  document.getElementById('project-form').reset();
  document.getElementById('edit-id').value = '';
  document.getElementById('form-title').textContent = 'Add New Project';
  document.getElementById('save-btn-text').textContent = 'Publish to Website →';
  document.getElementById('media-image').style.display = 'flex';
  document.getElementById('media-youtube').style.display = 'none';
  document.getElementById('media-vimeo').style.display = 'none';
  document.getElementById('media-video').style.display = 'none';
  document.getElementById('image-preview').style.display = 'none';
  document.getElementById('image-upload-zone').style.display = 'block';
  document.getElementById('video-name').style.display = 'none';
  document.getElementById('form-error').style.display = 'none';
  uploadedFileBase64 = null;
  uploadedFileName = null;
}

// ---- EDIT PROJECT ----
function editProject(id) {
  const p = (portfolioState.projects || []).find(item => item.id === id);
  if (!p) return;

  switchView('add-project');
  document.getElementById('form-title').textContent = 'Edit Project';
  document.getElementById('save-btn-text').textContent = 'Update Project →';
  document.getElementById('edit-id').value = p.id;
  document.getElementById('p-title').value = p.title || '';
  document.getElementById('p-category').value = p.category || '';
  document.getElementById('p-type').value = p.type || 'image';
  document.getElementById('p-desc').value = p.description || '';
  document.getElementById('p-featured').checked = !!p.featured;

  // Trigger media type switch
  document.getElementById('p-type').dispatchEvent(new Event('change'));

  if (p.type === 'youtube') {
    document.getElementById('p-yt-url').value = p.src || '';
    document.getElementById('p-yt-thumb').value = p.thumbnail || '';
  } else if (p.type === 'vimeo') {
    document.getElementById('p-vim-url').value = p.src || '';
    document.getElementById('p-vim-thumb').value = p.thumbnail || '';
  } else if (p.type === 'video') {
    document.getElementById('p-vid-thumb').value = p.thumbnail || '';
  } else {
    document.getElementById('p-img-url').value = p.src || '';
    if (p.src) {
      document.getElementById('preview-img').src = p.src;
      document.getElementById('image-preview').style.display = 'block';
      document.getElementById('image-upload-zone').style.display = 'none';
    }
  }
}

// ---- SAVE PROJECT (UPLOAD MEDIA + COMMIT PORTFOLIO.JSON) ----
async function handleProjectSave(e) {
  e.preventDefault();
  const token = localStorage.getItem(KEY_TOKEN);
  const saveBtn = document.getElementById('save-project-btn');
  const errBox  = document.getElementById('form-error');
  errBox.style.display = 'none';

  const editId   = document.getElementById('edit-id').value;
  const title    = document.getElementById('p-title').value.trim();
  const category = document.getElementById('p-category').value;
  const type     = document.getElementById('p-type').value;
  const desc     = document.getElementById('p-desc').value.trim();
  const featured = document.getElementById('p-featured').checked;

  if (!title || !category || !type) {
    errBox.textContent = 'Please fill in Title, Category, and Media Type.';
    errBox.style.display = 'block';
    return;
  }

  saveBtn.disabled = true;
  saveBtn.innerHTML = '<span>⏳ Uploading & Publishing...</span>';

  try {
    let mediaSrc = '';
    let mediaThumb = '';

    // Upload file if new base64 file exists
    if (uploadedFileBase64 && uploadedFileName) {
      const uploadRes = await uploadFileToGitHub(uploadedFileName, uploadedFileBase64, `Upload ${title} asset`, token);
      mediaSrc = uploadRes.content.download_url;
      if (type === 'image') mediaThumb = mediaSrc;
    }

    if (type === 'image') {
      if (!mediaSrc) mediaSrc = document.getElementById('p-img-url').value.trim();
      if (!mediaThumb) mediaThumb = mediaSrc;
      if (!mediaSrc) throw new Error('Please upload an image or provide an Image URL.');
    } else if (type === 'youtube') {
      const rawUrl = document.getElementById('p-yt-url').value.trim();
      if (!rawUrl) throw new Error('Please enter YouTube URL.');
      mediaSrc = formatYouTubeEmbed(rawUrl);
      mediaThumb = document.getElementById('p-yt-thumb').value.trim() || getYouTubeThumb(rawUrl);
    } else if (type === 'vimeo') {
      const rawUrl = document.getElementById('p-vim-url').value.trim();
      if (!rawUrl) throw new Error('Please enter Vimeo URL.');
      mediaSrc = formatVimeoEmbed(rawUrl);
      mediaThumb = document.getElementById('p-vim-thumb').value.trim();
    } else if (type === 'video') {
      if (!mediaSrc) throw new Error('Please upload an MP4 video or use YouTube/Vimeo for external video hosting.');
      mediaThumb = document.getElementById('p-vid-thumb').value.trim() || '';
    }

    // Prepare project record
    const projectRecord = {
      id: editId || ('proj_' + Date.now()),
      title: title,
      category: category,
      type: type,
      src: mediaSrc,
      thumbnail: mediaThumb,
      description: desc,
      featured: featured,
      date: new Date().toISOString().split('T')[0]
    };

    if (editId) {
      const idx = portfolioState.projects.findIndex(p => p.id === editId);
      if (idx !== -1) portfolioState.projects[idx] = projectRecord;
    } else {
      portfolioState.projects.unshift(projectRecord);
    }

    // Commit updated portfolio.json
    await commitPortfolioJson(`Update project: ${title}`, token);

    showToast('Project published successfully to website!', 'success');
    switchView('projects');
    renderDashboard();
    renderProjectsTable('all');
  } catch (err) {
    console.error('Error saving project:', err);
    errBox.textContent = err.message;
    errBox.style.display = 'block';
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = `<span id="save-btn-text">${editId ? 'Update Project →' : 'Publish to Website →'}</span>`;
  }
}

// ---- DELETE PROJECT ----
function promptDelete(id, title) {
  currentDeletingId = id;
  document.getElementById('modal-title').textContent = 'Confirm Delete';
  document.getElementById('modal-msg').textContent = `Are you sure you want to delete "${title}"? This will remove it from the live portfolio.`;
  document.getElementById('confirm-modal').style.display = 'flex';
}

async function executeDelete() {
  if (!currentDeletingId) return;
  const token = localStorage.getItem(KEY_TOKEN);
  const confirmBtn = document.getElementById('modal-confirm');
  confirmBtn.disabled = true;
  confirmBtn.textContent = 'Deleting...';

  try {
    portfolioState.projects = (portfolioState.projects || []).filter(p => p.id !== currentDeletingId);
    await commitPortfolioJson(`Delete project ${currentDeletingId}`, token);
    document.getElementById('confirm-modal').style.display = 'none';
    currentDeletingId = null;
    showToast('Project deleted successfully.', 'info');
    renderDashboard();
    renderProjectsTable('all');
  } catch (err) {
    showToast('Failed to delete: ' + err.message, 'error');
  } finally {
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Delete';
  }
}

// ---- SETTINGS SAVE ----
function populateSettingsForm() {
  const s = portfolioState.settings || {};
  document.getElementById('s-name').value = s.name || '';
  document.getElementById('s-title').value = s.title || '';
  document.getElementById('s-tagline').value = s.tagline || '';
  document.getElementById('s-email').value = s.email || '';
  document.getElementById('s-phone').value = s.phone || '';
  document.getElementById('s-about').value = s.about || '';
}

async function handleSettingsSave(e) {
  e.preventDefault();
  const token = localStorage.getItem(KEY_TOKEN);
  const msgEl = document.getElementById('settings-msg');
  msgEl.style.display = 'none';

  const newPass = document.getElementById('s-password').value.trim();
  const newToken = document.getElementById('s-token').value.trim();

  if (newPass) {
    localStorage.setItem(KEY_PASS, newPass);
    showToast('Admin password updated!', 'success');
  }
  if (newToken) {
    localStorage.setItem(KEY_TOKEN, newToken);
    showToast('GitHub token updated!', 'success');
  }

  portfolioState.settings = {
    name: document.getElementById('s-name').value.trim(),
    title: document.getElementById('s-title').value.trim(),
    tagline: document.getElementById('s-tagline').value.trim(),
    email: document.getElementById('s-email').value.trim(),
    phone: document.getElementById('s-phone').value.trim(),
    about: document.getElementById('s-about').value.trim()
  };

  try {
    await commitPortfolioJson('Update site settings via CMS', token);
    msgEl.textContent = '✓ Settings successfully saved and published!';
    msgEl.style.display = 'block';
    setTimeout(() => { msgEl.style.display = 'none'; }, 4000);
  } catch (err) {
    showToast('Failed to save settings: ' + err.message, 'error');
  }
}

// ---- GITHUB API HELPERS ----
async function uploadFileToGitHub(filePath, base64Content, commitMsg, token) {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: commitMsg,
      content: base64Content,
      branch: BRANCH
    })
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || 'Error uploading file to GitHub');
  }
  return await res.json();
}

async function commitPortfolioJson(commitMsg, token) {
  const jsonString = JSON.stringify(portfolioState, null, 2);
  // Safe UTF-8 to Base64 encoding
  const base64Json = btoa(unescape(encodeURIComponent(jsonString)));

  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${DATA_FILE}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: commitMsg,
      content: base64Json,
      sha: fileSha,
      branch: BRANCH
    })
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || 'Error updating portfolio.json');
  }
  const result = await res.json();
  fileSha = result.content.sha;
  return result;
}

// ---- EMBED & THUMBNAIL UTILS ----
function formatYouTubeEmbed(url) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  if (match && match[2].length === 11) {
    return `https://www.youtube.com/embed/${match[2]}`;
  }
  return url;
}

function getYouTubeThumb(url) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  if (match && match[2].length === 11) {
    return `https://img.youtube.com/vi/${match[2]}/maxresdefault.jpg`;
  }
  return '';
}

function formatVimeoEmbed(url) {
  const match = url.match(/(?:vimeo)\.com.*(?:videos|video|channels|)\/([\d]+)/i);
  if (match && match[1]) {
    return `https://player.vimeo.com/video/${match[1]}`;
  }
  return url;
}

// ---- TOAST UTILITY ----
function showToast(message, type = 'info') {
  const existing = document.querySelector('.admin-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `admin-toast ${type}`;
  toast.innerHTML = `<span>${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span> ${message}`;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toastIn 0.3s ease reverse';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
