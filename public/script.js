const databaseKey = "ovaryPlatformCases";
const databaseVersionKey = "ovaryPlatformCasesVersion";
const databaseVersion = "cases-v8-four-role-permissions";
const uploadBlobDbName = "ovaryPlatformUploadBlobs";
const uploadBlobStore = "blobs";
const userProfileKey = "ovaryPlatformUserProfile";
const userRegistryKey = "ovaryPlatformUsers";
const userHistoryKey = "ovaryPlatformUserHistory";
const cloudflareApiOrigin = "https://ovary-imaging-platform.2661969939.workers.dev";
const sharedApiBase = window.location.hostname.endsWith("github.io") ? cloudflareApiOrigin : "";
const adminEmployeeIds = ["12345678"];
const organizationOptions = [
  "总PI单位",
  ...Array.from({ length: 5 }, (_, index) => `共建PI单位 ${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 20 }, (_, index) => `分PI单位 ${String(index + 1).padStart(2, "0")}`),
];

function sharedApiUrl(path) {
  return `${sharedApiBase}${path}`;
}
const defaultUserProfile = {
  username: "管理员",
  contact: "管理员",
  phone: "13800000000",
  organization: "总PI单位",
  department: "超声科",
  title: "主任医师",
  role: "平台管理员",
  roleType: "platform_admin",
  employeeId: "12345678",
  password: "12345678",
  avatar: "",
};
const defaultCases = [
  { id: "CASE-2026-001", name: "病例一", age: 42, org: "总PI单位", part: "卵巢", status: "待初审", progress: 30, diagnosis: "卵巢囊性包块待评估", hidden: false, createdBy: "管理员", shareWithOrganization: true },
  { id: "CASE-2026-002", name: "病例二", age: 45, org: "总PI单位", part: "卵巢", status: "待初审", progress: 45, diagnosis: "卵巢占位性质待查", hidden: false, createdBy: "管理员", shareWithOrganization: true },
  { id: "CASE-2026-003", name: "病例三", age: 39, org: "共建PI单位 01", part: "附件区", status: "待质控", progress: 52, diagnosis: "附件区囊实性包块", hidden: false, createdBy: "共建PI录入员", shareWithOrganization: true },
  { id: "CASE-2026-004", name: "病例四", age: 51, org: "分PI单位 01", part: "卵巢", status: "退审中", progress: 38, diagnosis: "影像资料待补充", hidden: false, createdBy: "分PI录入员", shareWithOrganization: true },
  { id: "CASE-2026-005", name: "病例五", age: 57, org: "总PI单位", part: "盆腔", status: "待入库", progress: 90, diagnosis: "术后病理结果复核", hidden: false, createdBy: "管理员", shareWithOrganization: true },
  { id: "CASE-2026-006", name: "病例六", age: 48, org: "共建PI单位 02", part: "卵巢", status: "已入库", progress: 100, diagnosis: "卵巢实性结节待查", hidden: false, createdBy: "共建PI录入员", shareWithOrganization: true },
];

function loadCases() {
  try {
    if (localStorage.getItem(databaseVersionKey) !== databaseVersion) {
      localStorage.setItem(databaseVersionKey, databaseVersion);
      localStorage.setItem(databaseKey, JSON.stringify(defaultCases));
      return structuredClone(defaultCases);
    }
    const saved = JSON.parse(localStorage.getItem(databaseKey) || "[]");
    if (Array.isArray(saved) && saved.length) {
      localStorage.setItem(databaseVersionKey, databaseVersion);
      const known = new Set(saved.map((item) => item.id));
      const merged = saved.concat(structuredClone(defaultCases).filter((item) => !known.has(item.id)));
      return merged;
    }
    return structuredClone(defaultCases);
  } catch {
    return structuredClone(defaultCases);
  }
}

let cases = loadCases();
cases.forEach((item) => {
  item.uploads = item.uploads || [];
});
if (!cases.length) cases = structuredClone(defaultCases);
let lastDatabaseSnapshot = localStorage.getItem(databaseKey) || JSON.stringify(cases);
const caseDataChannel = "BroadcastChannel" in window ? new BroadcastChannel("ovary-platform-case-updates") : null;
let remoteCaseSyncTimer = null;
let remoteCaseSnapshot = "";
const scanTypes = {
  gray: {
    title: "灰阶超声",
    note: "支持上传灰阶静态图像和动态视频，系统按当前超声分类归档。",
    empty: "暂无灰阶超声",
  },
  color: {
    title: "彩色多普勒超声",
    note: "支持上传彩色多普勒超声资料，建议保留完整血流显示区域。",
    empty: "暂无彩色多普勒超声",
  },
  spectrum: {
    title: "频谱多普勒超声",
    note: "支持上传频谱多普勒超声资料，建议保留测量值、采样门位置和速度曲线。",
    empty: "暂无频谱多普勒超声",
  },
  threeD: {
    title: "三维超声",
    note: "支持上传三维超声资料，无该类检查时可不上传。",
    empty: "暂无三维超声",
  },
  contrast: {
    title: "超声造影",
    note: "支持上传超声造影资料，系统按超声造影分类归档。",
    empty: "暂无超声造影",
  },
  elastography: {
    title: "弹性成像",
    note: "支持上传弹性成像资料，无该类检查时可不上传。",
    empty: "暂无弹性成像",
  },
};

function getImageCategories() {
  return Object.keys(scanTypes);
}

let selectedCase = cases[0];
let activeStatus = "待初审";
let activeScan = "gray";
let uploadTarget = "超声图像";
let uploadCategory = "gray";
let pendingUploadRequest = null;
let caseCounter = Math.max(6, ...cases.map((item) => Number(String(item.id).match(/(\d+)$/)?.[1] || 0)));
let uploadCounter = 0;
const selectedIds = new Set();
const selectedUploadIds = new Set();
const thumbnailJobs = new Set();
const videoThumbnailVersion = 2;

const rows = document.querySelector("#caseRows");
const statusCards = document.querySelectorAll(".status-card");
const fileInput = document.querySelector("#fileInput");
const imageGrid = document.querySelector("#imageGrid");
const uploadZone = document.querySelector("#uploadZone");
const uploadList = document.querySelector("#uploadList");
const reportAllFiles = document.querySelector("#reportAllFiles");
const caseSelector = document.querySelector("#caseSelector");
const uploadCaseSelector = document.querySelector("#uploadCaseSelector");
const reportCaseSelector = document.querySelector("#reportCaseSelector");
const reportTotalCount = document.querySelector("#reportTotalCount");
const reportPatientSummary = document.querySelector("#reportPatientSummary");
const reportFileContainers = {
  lab: document.querySelector("#labFiles"),
  pathology: document.querySelector("#pathologyFiles"),
  ct: document.querySelector("#ctFiles"),
  other: document.querySelector("#otherFiles"),
  followup: document.querySelector("#followupFiles"),
};
const uploadLibraryMeta = document.querySelector("#uploadLibraryMeta");
const homePendingReview = document.querySelector("#homePendingReview");
const homePendingQc = document.querySelector("#homePendingQc");
const homeMissingReports = document.querySelector("#homeMissingReports");
const homeMessageHint = document.querySelector("#homeMessageHint");
const imageQcNodes = {
  grayCount: document.querySelector("#qcGrayCount"),
  colorCount: document.querySelector("#qcColorCount"),
  spectrumCount: document.querySelector("#qcSpectrumCount"),
  threeDCount: document.querySelector("#qcThreeDCount"),
  grayStatus: document.querySelector("#qcGrayStatus"),
  colorStatus: document.querySelector("#qcColorStatus"),
  spectrumStatus: document.querySelector("#qcSpectrumStatus"),
  threeDStatus: document.querySelector("#qcThreeDStatus"),
  contrastCount: document.querySelector("#qcContrastCount"),
  elastographyCount: document.querySelector("#qcElastographyCount"),
  contrastStatus: document.querySelector("#qcContrastStatus"),
  elastographyStatus: document.querySelector("#qcElastographyStatus"),
  total: document.querySelector("#qcImageTotal"),
  pending: document.querySelector("#qcPendingTotal"),
  dicom: document.querySelector("#qcDicomTotal"),
};
const selectedCount = document.querySelector("#selectedCount");
const selectAllCases = document.querySelector("#selectAllCases");
const partFilter = document.querySelector("#partFilter");
const orgFilter = document.querySelector("#orgFilter");
const hiddenFilter = document.querySelector("#hiddenFilter");
const keywordInput = document.querySelector("#keywordInput");
const queryButton = document.querySelector("#queryButton");
const resetButton = document.querySelector("#resetButton");
const querySummary = document.querySelector("#querySummary");
const modalBackdrop = document.querySelector("#modalBackdrop");
const modalTitle = document.querySelector("#modalTitle");
const modalBody = document.querySelector("#modalBody");
const authGate = document.querySelector("#authGate");
const authLoginForm = document.querySelector("#authLoginForm");
const authRegisterForm = document.querySelector("#authRegisterForm");
const tciaUserName = document.querySelector("#tciaUserName");
const tciaUserAvatar = document.querySelector("#tciaUserAvatar");
const tciaLogoutButton = document.querySelector("#tciaLogoutButton");
const tciaProfileTrigger = document.querySelector("#tciaProfileTrigger");
const tciaUserTextButton = document.querySelector("#tciaUserTextButton");
const sendSmsCodeButton = document.querySelector("#sendSmsCode");
const adminUserCount = document.querySelector("#adminUserCount");
const adminRoleCount = document.querySelector("#adminRoleCount");
const adminOperationCount = document.querySelector("#adminOperationCount");
const adminUserTable = document.querySelector("#adminUserTable");
const adminOperationTable = document.querySelector("#adminOperationTable");
const adminCreateUserForm = document.querySelector("#adminCreateUserForm");
const adminUserSearchField = document.querySelector("#adminUserSearchField");
const adminUserSearchInput = document.querySelector("#adminUserSearchInput");
const adminUserSelector = document.querySelector("#adminUserSelector");
const adminSelectionSummary = document.querySelector("#adminSelectionSummary");
const adminSelectedActionButtons = document.querySelectorAll("[data-admin-selected-action]");
const sidebarRoleLabel = document.querySelector("#sidebarRoleLabel");
let queryApplied = false;
let activeQuery = "";
let authenticated = false;
let currentUserProfile = loadUserProfile();
let pendingSmsCode = "";
let selectedAdminUsername = "";
let pendingAdminAction = null;

function initializeOrganizationSelectors() {
  const registerOrganization = authRegisterForm?.querySelector('[name="organization"]');
  const adminOrganization = adminCreateUserForm?.querySelector('[name="organization"]');
  [registerOrganization, adminOrganization].forEach((selector) => {
    if (!selector) return;
    selector.innerHTML = organizationOptions.map((item) => `<option>${escapeHtml(item)}</option>`).join("");
  });
  if (orgFilter) {
    orgFilter.innerHTML = ['<option>全部</option>', ...organizationOptions.map((item) => `<option>${escapeHtml(item)}</option>`)].join("");
    orgFilter.value = "总PI单位";
  }
}

function loadUserProfile() {
  try {
    const saved = JSON.parse(localStorage.getItem(userProfileKey) || "null");
    return saved ? { ...defaultUserProfile, ...saved } : { ...defaultUserProfile };
  } catch {
    return { ...defaultUserProfile };
  }
}

function saveUserProfile() {
  localStorage.setItem(userProfileKey, JSON.stringify(currentUserProfile));
}

function normalizeRoleType(profile) {
  const type = profile?.roleType || (String(profile?.role || "").includes("管理员") ? "platform_admin" : "uploader");
  if (type === "admin") return "platform_admin";
  if (type === "user") return "uploader";
  return type;
}

function isAdminProfile(profile = currentUserProfile) {
  return ["platform_admin", "organization_admin"].includes(normalizeRoleType(profile));
}

function isPlatformAdmin(profile = currentUserProfile) {
  return normalizeRoleType(profile) === "platform_admin";
}

function roleLabel(profile) {
  const labels = {
    platform_admin: "平台管理员",
    organization_admin: "主体管理员",
    quality_reviewer: "质控员",
    uploader: "普通用户",
  };
  return labels[normalizeRoleType(profile)] || "普通用户";
}

const rolePermissions = {
  uploader: new Set(["home", "review_panel", "case_panel", "report_panel", "create_case", "upload", "preview", "download", "view_status"]),
  quality_reviewer: new Set(["home", "review_panel", "case_panel", "quality_panel", "report_panel", "upload", "preview", "download", "review", "quality"]),
  organization_admin: new Set(["home", "review_panel", "case_panel", "quality_panel", "report_panel", "users_panel", "config_panel", "create_case", "upload", "preview", "download", "review", "quality", "finalize", "export", "manage_users"]),
  platform_admin: new Set(["home", "review_panel", "case_panel", "quality_panel", "report_panel", "users_panel", "config_panel", "create_case", "upload", "preview", "download", "review", "quality", "finalize", "export", "manage_users", "cross_organization"]),
};

function hasPermission(permission, profile = currentUserProfile) {
  return rolePermissions[normalizeRoleType(profile)]?.has(permission) || false;
}

function canUploadToSelectedCase() {
  if (!selectedCase || !hasPermission("upload")) return false;
  return selectedCase.org === currentUserProfile.organization;
}

function canEditSelectedCase() {
  if (!selectedCase) return false;
  if (isAdminProfile()) return selectedCase.org === currentUserProfile.organization;
  const username = currentUserProfile.username || currentUserProfile.contact;
  return normalizeRoleType(currentUserProfile) === "uploader" && selectedCase.createdBy === username;
}

function canDeleteUpload(uploadId) {
  if (isAdminProfile()) return true;
  const file = selectedCase?.uploads.find((item) => item.id === uploadId);
  const username = currentUserProfile.username || currentUserProfile.contact;
  return hasPermission("upload") && file?.uploadedBy === username;
}

function requirePermission(permission, message) {
  if (hasPermission(permission)) return true;
  toast(message || "当前账号没有此操作权限");
  return false;
}

function canAccessPanel(panelId) {
  const permissionByPanel = {
    homePanel: "home",
    reviewPanel: "review_panel",
    casePanel: "case_panel",
    uploadPanel: "quality_panel",
    reportPanel: "report_panel",
    adminUsersPanel: "users_panel",
    configPanel: "config_panel",
  };
  return hasPermission(permissionByPanel[panelId] || "home");
}

function getVisibleCases() {
  if (isPlatformAdmin()) return cases;
  const sameOrganization = cases.filter((item) => item.org === currentUserProfile.organization);
  if (normalizeRoleType(currentUserProfile) !== "uploader") return sameOrganization;
  const username = currentUserProfile.username || currentUserProfile.contact;
  return sameOrganization.filter((item) => item.createdBy === username || item.shareWithOrganization === true);
}

function loadUsers() {
  try {
    const saved = JSON.parse(localStorage.getItem(userRegistryKey) || "[]");
    const users = Array.isArray(saved) ? saved : [];
    if (!users.some((user) => user.username === defaultUserProfile.username)) users.unshift({ ...defaultUserProfile });
    return users;
  } catch {
    return [{ ...defaultUserProfile }];
  }
}

function saveUsers(users) {
  localStorage.setItem(userRegistryKey, JSON.stringify(users));
}

function deleteUser(username) {
  const users = loadUsers().filter((user) => user.username !== username);
  saveUsers(users);
}

function upsertUser(profile) {
  const users = loadUsers();
  const username = String(profile.username || profile.contact || "").trim();
  const next = { ...defaultUserProfile, ...profile, username };
  const index = users.findIndex((user) => user.username === username);
  if (index >= 0) users[index] = { ...users[index], ...next };
  else users.push(next);
  saveUsers(users);
  return next;
}

function findUser(username) {
  const name = String(username || "").trim();
  return loadUsers().find((user) => user.username === name || user.contact === name) || null;
}

function validateAdminEmployeeId(employeeId) {
  return adminEmployeeIds.includes(String(employeeId || "").trim().toUpperCase());
}

function addUserHistory(type, detail) {
  try {
    const list = JSON.parse(localStorage.getItem(userHistoryKey) || "[]");
    list.unshift({
      type,
      detail,
      username: currentUserProfile.username || currentUserProfile.contact || "未知用户",
      contact: currentUserProfile.contact || currentUserProfile.username || "未知用户",
      roleType: normalizeRoleType(currentUserProfile),
      organization: currentUserProfile.organization || "未知机构",
      time: new Date().toLocaleString("zh-CN"),
    });
    localStorage.setItem(userHistoryKey, JSON.stringify(list.slice(0, 30)));
    renderAdminDashboard();
  } catch {
    // History is helpful but noncritical.
  }
}

function getUserHistory() {
  try {
    return JSON.parse(localStorage.getItem(userHistoryKey) || "[]");
  } catch {
    return [];
  }
}

function adminUserMatchesSearch(user, field, query) {
  if (!query) return true;
  const values = {
    username: user.username,
    employeeId: user.employeeId,
    organization: user.organization,
  };
  if (field !== "all") return String(values[field] || "").toLowerCase().includes(query);
  return [user.username, user.contact, user.employeeId, user.organization]
    .some((value) => String(value || "").toLowerCase().includes(query));
}

function selectedAdminUser() {
  return selectedAdminUsername ? findUser(selectedAdminUsername) : null;
}

function openAdminMessageForm(user) {
  openModal(
    "发送信息",
    `
      <form class="modal-form" id="adminMessageForm" data-username="${escapeHtml(user.username)}">
        <p class="modal-help">填写完成后还需在确认框中确定发送。</p>
        <label>接收人<input value="${escapeHtml(user.contact || user.username)}" disabled /></label>
        <label>消息标题<input name="title" required value="平台通知" /></label>
        <label class="full">消息内容<textarea name="message" required>请登录平台查看最新数据审核进展。</textarea></label>
        <div class="modal-actions">
          <button class="ghost modal-cancel" type="button">取消</button>
          <button class="primary" type="submit">下一步</button>
        </div>
      </form>
    `,
  );
}

function openAdminRoleForm(user) {
  const allowedRoles = isPlatformAdmin()
    ? [["uploader", "普通用户"], ["quality_reviewer", "质控员"], ["organization_admin", "主体管理员"], ["platform_admin", "平台管理员"]]
    : [["uploader", "普通用户"], ["quality_reviewer", "质控员"]];
  const organizations = isPlatformAdmin() ? organizationOptions : [currentUserProfile.organization];
  openModal(
    "调整用户角色",
    `
      <form class="modal-form" id="adminRoleForm" data-username="${escapeHtml(user.username)}">
        <p class="modal-help">设置完成后还需在确认框中确定调整。</p>
        <label>用户<input value="${escapeHtml(user.contact || user.username)}" readonly /></label>
        <label>角色<select name="role">${allowedRoles.map(([value, label]) => `<option value="${value}" ${value === normalizeRoleType(user) ? "selected" : ""}>${label}</option>`).join("")}</select></label>
        <label>所属机构<select name="organization">${organizations.map((item) => `<option ${item === user.organization ? "selected" : ""}>${item}</option>`).join("")}</select></label>
        <label>管理员员工编号<input name="employeeId" placeholder="调整为管理员时必填" /></label>
        <div class="modal-actions">
          <button class="ghost modal-cancel" type="button">取消</button>
          <button class="primary" type="submit">下一步</button>
        </div>
      </form>
    `,
  );
}

function openAdminActionConfirmation(action) {
  pendingAdminAction = action;
  const user = findUser(action.username);
  if (!user) {
    pendingAdminAction = null;
    toast("未找到该用户");
    return;
  }
  const target = `${user.contact || user.username}（${user.username}）`;
  const configs = {
    message: {
      title: "确认发送信息",
      prompt: `确定向 ${target} 发送“${action.title}”吗？`,
      detail: action.message,
      button: "确定发送",
      className: "primary",
    },
    role: {
      title: "确认调整角色",
      prompt: `确定将 ${target} 的角色调整为“${roleLabel({ roleType: action.roleType })}”吗？`,
      detail: `所属单位：${action.organization}`,
      button: "确定调整",
      className: "primary",
    },
    kick: {
      title: "确认踢出用户",
      prompt: `确定将 ${target} 踢出平台吗？`,
      detail: "执行后，该账号将从当前用户列表中移除。",
      button: "确定踢出",
      className: "danger",
    },
  };
  const config = configs[action.type];
  openModal(
    config.title,
    `
      <form class="modal-form" id="adminConfirmForm">
        <div class="admin-action-confirmation ${action.type === "kick" ? "is-danger" : ""}">
          <strong>${escapeHtml(config.prompt)}</strong>
          <p>${escapeHtml(config.detail)}</p>
        </div>
        <div class="modal-actions">
          <button class="ghost modal-cancel" type="button">取消</button>
          <button class="${config.className}" type="submit">${config.button}</button>
        </div>
      </form>
    `,
  );
}

function renderAdminDashboard() {
  if (!adminUserTable || !adminOperationTable) return;
  const users = loadUsers();
  const visibleUsers = isPlatformAdmin() ? users : users.filter((user) => user.organization === currentUserProfile.organization);
  const manageableUsers = isPlatformAdmin()
    ? visibleUsers.filter((user) => user.username !== currentUserProfile.username)
    : visibleUsers.filter((user) => ["uploader", "quality_reviewer"].includes(normalizeRoleType(user)));
  const history = isPlatformAdmin()
    ? getUserHistory()
    : getUserHistory().filter((item) => item.organization === currentUserProfile.organization);
  const adminCount = visibleUsers.filter(isAdminProfile).length;
  if (adminUserCount) adminUserCount.textContent = visibleUsers.filter((user) => !isAdminProfile(user)).length;
  if (adminRoleCount) adminRoleCount.textContent = adminCount;
  if (adminOperationCount) adminOperationCount.textContent = history.length;
  const locked = !isAdminProfile();
  document.querySelectorAll(".admin-overview-card, .admin-create-card, .admin-list-card").forEach((card) => {
    card.classList.toggle("admin-locked-card", locked);
  });
  [adminUserSearchField, adminUserSearchInput, adminUserSelector].forEach((control) => {
    if (control) control.disabled = locked;
  });
  if (locked) {
    selectedAdminUsername = "";
    if (adminSelectionSummary) adminSelectionSummary.textContent = "当前账号无用户管理权限";
    adminSelectedActionButtons.forEach((button) => { button.disabled = true; });
    adminUserTable.innerHTML = '<div class="admin-empty">当前账号不是平台或主体管理员，无权查看用户。</div>';
    adminOperationTable.innerHTML = '<div class="admin-empty">当前账号不是管理员，无权查看操作记录。</div>';
    if (adminCreateUserForm) Array.from(adminCreateUserForm.elements).forEach((el) => { el.disabled = true; });
    return;
  }
  if (adminCreateUserForm) {
    Array.from(adminCreateUserForm.elements).forEach((el) => { el.disabled = false; });
    const roleSelect = adminCreateUserForm.querySelector('[name="role"]');
    const organizationSelect = adminCreateUserForm.querySelector('[name="organization"]');
    if (roleSelect) {
      roleSelect.innerHTML = isPlatformAdmin()
        ? '<option value="uploader">普通用户</option><option value="quality_reviewer">质控员</option><option value="organization_admin">主体管理员</option><option value="platform_admin">平台管理员</option>'
        : '<option value="uploader">普通用户</option><option value="quality_reviewer">质控员</option>';
    }
    if (organizationSelect) {
      organizationSelect.value = currentUserProfile.organization;
      organizationSelect.disabled = !isPlatformAdmin();
    }
  }
  const searchField = adminUserSearchField?.value || "all";
  const searchQuery = String(adminUserSearchInput?.value || "").trim().toLowerCase();
  const filteredUsers = manageableUsers.filter((user) => adminUserMatchesSearch(user, searchField, searchQuery));
  if (!manageableUsers.some((user) => user.username === selectedAdminUsername)
      || !filteredUsers.some((user) => user.username === selectedAdminUsername)) {
    selectedAdminUsername = "";
  }
  const selectedUser = manageableUsers.find((user) => user.username === selectedAdminUsername);
  if (adminUserSelector) {
    adminUserSelector.innerHTML = [
      '<option value="">请先搜索并选择用户</option>',
      ...filteredUsers.map((user) => `
        <option value="${escapeHtml(user.username || "")}">
          ${escapeHtml(user.contact || user.username || "-")} · ${escapeHtml(user.username || "-")} · ${escapeHtml(user.employeeId || "无编号")} · ${escapeHtml(user.organization || "无单位")}
        </option>
      `),
    ].join("");
    adminUserSelector.value = selectedAdminUsername;
  }
  if (adminSelectionSummary) {
    adminSelectionSummary.innerHTML = selectedUser
      ? `已选择：<strong>${escapeHtml(selectedUser.contact || selectedUser.username)}</strong>　用户名 ${escapeHtml(selectedUser.username || "-")}　编号 ${escapeHtml(selectedUser.employeeId || "未填写")}　单位 ${escapeHtml(selectedUser.organization || "-")}`
      : `尚未选择用户${searchQuery && !filteredUsers.length ? "，没有符合搜索条件的用户" : ""}`;
  }
  adminSelectedActionButtons.forEach((button) => { button.disabled = !selectedUser; });
  adminUserTable.innerHTML = filteredUsers.length
    ? `
      <div class="admin-user-list">
        ${filteredUsers.map((user) => `
          <article class="admin-user-row ${user.username === selectedAdminUsername ? "is-selected" : ""}" data-username="${escapeHtml(user.username || "")}" tabindex="0">
            <label class="admin-user-radio" title="选择该用户">
              <input type="radio" name="adminSelectedUser" value="${escapeHtml(user.username || "")}" ${user.username === selectedAdminUsername ? "checked" : ""} />
            </label>
            <div class="admin-user-avatar">${user.avatar ? `<img src="${user.avatar}" alt="" />` : escapeHtml((user.contact || user.username || "用").slice(0, 1))}</div>
            <div class="admin-user-main">
              <strong>${escapeHtml(user.contact || user.username || "-")}</strong>
              <span>${escapeHtml(user.username || "-")}</span>
            </div>
            <div><span>员工编号</span><strong>${escapeHtml(user.employeeId || "未填写")}</strong></div>
            <div><span>所属机构</span><strong>${escapeHtml(user.organization || "-")}</strong></div>
            <div><span>科室</span><strong>${escapeHtml(user.department || "-")}</strong></div>
            <div><span>职称</span><strong>${escapeHtml(user.title || "-")}</strong></div>
            <div><span>角色</span><strong>${roleLabel(user)}</strong></div>
          </article>
        `).join("")}
      </div>
    `
    : `<div class="admin-empty">${searchQuery ? "没有符合搜索条件的用户。" : "当前权限范围内暂无可管理用户。"}</div>`;
  adminOperationTable.innerHTML = history.length
    ? `
      <div class="admin-table-row admin-table-head"><span>用户</span><span>权限</span><span>操作</span><span>详情</span><span>时间</span></div>
      ${history.map((item) => `
        <div class="admin-table-row">
          <span>${escapeHtml(item.contact || item.username || "-")}</span>
          <span>${roleLabel(item)}</span>
          <span>${escapeHtml(item.type || "-")}</span>
          <span>${escapeHtml(item.detail || "-")}</span>
          <span>${escapeHtml(item.time || "-")}</span>
        </div>
      `).join("")}
    `
    : '<div class="admin-empty">暂无操作记录。</div>';
}

function applyRolePermissions() {
  const roleType = normalizeRoleType(currentUserProfile);
  document.querySelectorAll("[data-panel]").forEach((element) => {
    element.hidden = !canAccessPanel(element.dataset.panel);
  });
  document.querySelectorAll('[data-panel="reviewPanel"]').forEach((element) => {
    if (element.closest(".flow-guide")) return;
    if (["BUTTON"].includes(element.tagName) && !element.querySelector("strong")) {
      element.textContent = roleType === "uploader" ? "病例状态" : "数据初审";
    }
  });
  document.querySelectorAll('[data-action="new-case"]').forEach((element) => { element.hidden = !hasPermission("create_case"); });
  document.querySelectorAll('[data-action="export"], [data-action="batch-export"], [data-action="export-ledger"], [data-action="export-patient-report"]').forEach((element) => {
    element.hidden = !hasPermission("export");
  });
  document.querySelectorAll('[data-action="batch-store"], [data-finalize-only]').forEach((element) => {
    element.hidden = !hasPermission("finalize");
  });
  document.querySelectorAll('[data-action="toggle-organization-share"]').forEach((element) => {
    element.hidden = !isAdminProfile();
    element.textContent = selectedCase?.shareWithOrganization ? "取消本院共享" : "授权本院可见";
  });
  document.querySelectorAll(".upload-button, #pickFiles").forEach((element) => {
    element.hidden = !hasPermission("upload");
    element.disabled = !canUploadToSelectedCase();
    element.title = element.disabled ? "只能向本单位病例上传资料" : "";
  });
  if (uploadZone) uploadZone.hidden = !hasPermission("upload");
  document.querySelectorAll("[data-platform-review-notice]").forEach((element) => {
    element.hidden = !isPlatformAdmin();
  });
  document.querySelectorAll(".review-bar").forEach((element) => {
    element.hidden = false;
    element.querySelectorAll("button[data-review]").forEach((button) => {
      button.hidden = !hasPermission("review");
      button.disabled = !selectedUploadIds.size;
    });
    const hint = element.querySelector(".selection-hint");
    if (hint) hint.hidden = !hasPermission("review") || Boolean(selectedUploadIds.size);
  });
  document.querySelectorAll('[data-role-action="upload"]').forEach((element) => {
    element.hidden = !hasPermission("upload");
    element.disabled = !canUploadToSelectedCase();
    element.title = element.disabled ? "只能向本单位病例上传资料" : "";
    if (!element.hidden) {
      const stage = element.closest("[data-workflow-stage]")?.dataset.workflowStage;
      element.textContent = stage === "report"
        ? "上传报告资料"
        : stage === "quality"
          ? "补充影像资料"
          : roleType === "platform_admin"
            ? "本单位上传资料"
            : roleType === "organization_admin"
              ? "本院上传资料"
              : "上传资料";
    }
  });
  document.querySelectorAll('[data-role-action="preview"]').forEach((element) => {
    element.hidden = !hasPermission("preview");
    element.disabled = !selectedCase?.uploads?.length;
  });
  document.querySelectorAll('[data-role-action="download"]').forEach((element) => {
    element.hidden = !hasPermission("download");
    element.disabled = !selectedCase?.uploads?.length;
    element.textContent = `下载病例资料（${selectedCase?.uploads?.length || 0}）`;
  });
  document.querySelectorAll('[data-role-action="finalize"]').forEach((element) => {
    element.hidden = !hasPermission("finalize");
  });
  document.querySelectorAll("[data-admin-only]").forEach((element) => { element.hidden = !isAdminProfile(); });
  document.querySelectorAll("[data-platform-config]").forEach((element) => { element.hidden = !isPlatformAdmin(); });
  document.querySelectorAll(".delete-file").forEach((element) => { element.hidden = !canDeleteUpload(element.dataset.uploadId); });
  document.querySelectorAll(".upload-check, .upload-select").forEach((element) => {
    element.hidden = !(hasPermission("review") || hasPermission("quality") || hasPermission("finalize"));
  });
  document.querySelectorAll(".case-check").forEach((element) => {
    element.hidden = !(hasPermission("export") || hasPermission("finalize"));
  });
  document.querySelectorAll("#casePanel .tab-content input:not([type='file']), #casePanel .tab-content select, #casePanel .tab-content textarea").forEach((element) => {
    element.disabled = !canEditSelectedCase();
  });
  document.querySelectorAll("[data-save-section]").forEach((element) => {
    element.disabled = !canEditSelectedCase();
  });
  if (selectAllCases) selectAllCases.hidden = !(hasPermission("export") || hasPermission("finalize"));
  document.querySelectorAll('[data-action="store-current"]').forEach((element) => {
    element.textContent = isPlatformAdmin() ? "审核并入库" : "本院最终入库";
  });
  document.querySelectorAll('[data-action="batch-store"]').forEach((element) => {
    element.textContent = isPlatformAdmin() ? "跨院审核并批量入库" : "本院批量入库";
  });
  if (sidebarRoleLabel) {
    const scope = isPlatformAdmin() ? "全部主体" : currentUserProfile.organization || "本主体";
    sidebarRoleLabel.textContent = `${roleLabel(currentUserProfile)} · ${scope}`;
  }
  const activePanel = document.querySelector(".view-panel.active");
  if (activePanel && !canAccessPanel(activePanel.id)) {
    document.querySelectorAll(".view-panel").forEach((panel) => panel.classList.toggle("active", panel.id === "homePanel"));
  }
}

function setCurrentUser(profile) {
  if (typeof profile === "string") {
    currentUserProfile = { ...currentUserProfile, username: profile || "管理员", contact: profile || "管理员" };
  } else if (profile) {
    currentUserProfile = { ...currentUserProfile, ...profile };
  }
  if (currentUserProfile.organization === "共建PI单位") currentUserProfile.organization = "共建PI单位 01";
  if (currentUserProfile.organization === "分PI单位") currentUserProfile.organization = "分PI单位 01";
  currentUserProfile.roleType = normalizeRoleType(currentUserProfile);
  currentUserProfile.role = roleLabel(currentUserProfile);
  if (isPlatformAdmin()) currentUserProfile.organization = "总PI单位";
  const displayName = currentUserProfile.contact || currentUserProfile.username || "管理员";
  if (tciaUserName) tciaUserName.textContent = displayName;
  if (tciaUserAvatar) {
    if (currentUserProfile.avatar) {
      tciaUserAvatar.innerHTML = `<img src="${currentUserProfile.avatar}" alt="" />`;
    } else {
      tciaUserAvatar.textContent = displayName.slice(0, 1);
    }
  }
  document.body.dataset.role = normalizeRoleType(currentUserProfile);
  const visibleCases = getVisibleCases();
  if (visibleCases.length && !visibleCases.some((item) => item.id === selectedCase.id)) selectedCase = visibleCases[0];
  if (!visibleCases.length) {
    document.querySelectorAll(".view-panel").forEach((panel) => panel.classList.toggle("active", panel.id === "homePanel"));
    document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.panel === "homePanel"));
  }
  if (visibleCases.length && !visibleCases.some((item) => item.status === activeStatus)) {
    activeStatus = selectedCase.status;
    statusCards.forEach((card) => card.classList.toggle("active", card.dataset.status === activeStatus));
  }
  if (orgFilter && !isPlatformAdmin()) {
    orgFilter.value = currentUserProfile.organization;
    orgFilter.disabled = true;
  } else if (orgFilter) {
    orgFilter.disabled = false;
  }
  applyRolePermissions();
  renderAdminDashboard();
  renderRows();
  if (selectedCase && visibleCases.some((item) => item.id === selectedCase.id)) updateDetail(selectedCase);
}

function setAuthenticated(value) {
  authenticated = Boolean(value);
  if (authenticated) {
    document.body.classList.remove("app-locked");
    if (authGate) authGate.setAttribute("hidden", "");
    setCurrentUser(currentUserProfile);
    syncCasesFromServer(true);
  } else {
    document.body.classList.add("app-locked");
    if (authGate) authGate.removeAttribute("hidden");
  }
}

function initializeAuthGate() {
  setAuthenticated(false);
  const registerView = window.location.hash === "#register";
  const targetView = registerView ? "register" : "login";
  document.querySelector(`[data-auth-view="${targetView}"]`)?.click();
  const draftKey = registerView ? "ovaryPlatformRegisterDraft" : "ovaryPlatformLoginDraft";
  try {
    const draft = JSON.parse(sessionStorage.getItem(draftKey) || "null");
    const form = registerView ? authRegisterForm : authLoginForm;
    if (draft && form) {
      Object.entries(draft).forEach(([name, value]) => {
        const field = form.elements.namedItem(name);
        if (field && field.type !== "file") field.value = value;
      });
      sessionStorage.removeItem(draftKey);
      if (!registerView) window.setTimeout(() => form.requestSubmit(), 0);
    }
  } catch {
    sessionStorage.removeItem(draftKey);
  }
  if (window.location.hash && window.history?.replaceState) {
    window.history.replaceState(null, "", window.location.pathname);
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function openUploadBlobDb() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("当前浏览器不支持 IndexedDB"));
      return;
    }
    const request = indexedDB.open(uploadBlobDbName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(uploadBlobStore, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("文件数据库打开失败"));
  });
}

async function storeUploadBlob(id, blob, meta = {}) {
  const db = await openUploadBlobDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(uploadBlobStore, "readwrite");
    tx.objectStore(uploadBlobStore).put({ id, blob, ...meta, savedAt: new Date().toISOString() });
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error("文件保存失败"));
    };
  });
}

async function getUploadBlob(id) {
  if (!id) return null;
  const db = await openUploadBlobDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(uploadBlobStore, "readonly");
    const request = tx.objectStore(uploadBlobStore).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error("文件读取失败"));
    tx.oncomplete = () => db.close();
  });
}

async function findUploadBlobByName(name) {
  if (!name) return null;
  const db = await openUploadBlobDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(uploadBlobStore, "readonly");
    const request = tx.objectStore(uploadBlobStore).getAll();
    request.onsuccess = () => {
      const matches = (request.result || [])
        .filter((record) => record.name === name)
        .sort((left, right) => String(right.savedAt || "").localeCompare(String(left.savedAt || "")));
      resolve(matches[0] || null);
    };
    request.onerror = () => reject(request.error || new Error("文件数据库读取失败"));
    tx.oncomplete = () => db.close();
  });
}

function renderAviThumb(file) {
  return `<div class="avi-thumb" aria-label="${escapeHtml(file.name)} AVI 文件"><strong>AVI</strong><span>动态视频</span></div>`;
}

function imageBlobToThumbnail(blob) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(blob);
    image.onload = () => {
      try {
        const maxWidth = 640;
        const maxHeight = 360;
        const scale = Math.min(1, maxWidth / image.naturalWidth, maxHeight / image.naturalHeight);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/jpeg", 0.78));
      } catch (error) {
        URL.revokeObjectURL(url);
        reject(error);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("AVI 内的视频帧无法读取"));
    };
    image.src = url;
  });
}

async function extractFirstJpegFrameFromAvi(blob) {
  const scanLimit = Math.min(blob.size, 64 * 1024 * 1024);
  const bytes = new Uint8Array(await blob.slice(0, scanLimit).arrayBuffer());
  let frameStart = -1;
  for (let index = 0; index < bytes.length - 1; index += 1) {
    if (frameStart < 0 && bytes[index] === 0xff && bytes[index + 1] === 0xd8) {
      frameStart = index;
      index += 1;
      continue;
    }
    if (frameStart >= 0 && bytes[index] === 0xff && bytes[index + 1] === 0xd9) {
      const frame = blob.slice(frameStart, index + 2, "image/jpeg");
      return imageBlobToThumbnail(frame);
    }
  }
  throw new Error("AVI 文件中未找到可提取的 JPEG 视频帧");
}

function captureVideoFrame(blob, seconds = 1) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(blob);
    let settled = false;
    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
    };
    const finish = (value, error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(value);
    };
    const timer = window.setTimeout(() => finish("", new Error("视频预览帧生成超时")), 8000);
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.addEventListener("loadedmetadata", () => {
      const target = Number.isFinite(video.duration) && video.duration > 0 ? Math.min(seconds, Math.max(0, video.duration - 0.05)) : seconds;
      try {
        video.currentTime = target;
      } catch (error) {
        window.clearTimeout(timer);
        finish("", error);
      }
    });
    video.addEventListener("seeked", () => {
      try {
        const width = video.videoWidth || 640;
        const height = video.videoHeight || 360;
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0, width, height);
        window.clearTimeout(timer);
        finish(canvas.toDataURL("image/jpeg", 0.86));
      } catch (error) {
        window.clearTimeout(timer);
        finish("", error);
      }
    });
    video.addEventListener("error", () => {
      window.clearTimeout(timer);
      finish("", new Error("浏览器无法解码该视频格式"));
    });
    video.src = url;
  });
}

async function createVideoThumbnail(blob, fileName = "") {
  const name = String(fileName || blob.name || "").toLowerCase();
  if (name.endsWith(".avi") || ["video/avi", "video/x-msvideo"].includes(blob.type)) {
    try {
      return await extractFirstJpegFrameFromAvi(blob);
    } catch {
      // Some AVI codecs do not store MJPEG frames; let the browser decoder try next.
    }
  }
  return captureVideoFrame(blob, 1);
}

async function ensureVideoThumbnail(file) {
  if (
    !file ||
    file.kind !== "video" ||
    file.videoThumbSrc ||
    file.videoThumbVersion === videoThumbnailVersion ||
    thumbnailJobs.has(file.id)
  ) return;
  thumbnailJobs.add(file.id);
  try {
    const record = file.blobId ? await getUploadBlob(file.blobId) : await findUploadBlobByName(file.name);
    if (record?.id && !file.blobId) file.blobId = record.id;
    let sourceBlob = record?.blob || (file.videoSrc?.startsWith("data:") ? dataUrlToBlob(file.videoSrc) : null);
    if (!sourceBlob && file.remoteUrl) {
      const response = await fetch(file.remoteUrl);
      if (response.ok) sourceBlob = await response.blob();
    }
    if (!sourceBlob) {
      file.videoThumbFailed = true;
      file.videoThumbVersion = videoThumbnailVersion;
      saveDatabase();
      return;
    }
    const thumb = await createVideoThumbnail(sourceBlob, record?.name || file.name);
    if (thumb) {
      file.videoThumbSrc = thumb;
      file.videoThumbFailed = false;
      file.videoThumbVersion = videoThumbnailVersion;
      saveDatabase();
      renderUploadViews();
    } else {
      file.videoThumbFailed = true;
      file.videoThumbVersion = videoThumbnailVersion;
      saveDatabase();
    }
  } catch {
    file.videoThumbFailed = true;
    file.videoThumbVersion = videoThumbnailVersion;
    saveDatabase();
  } finally {
    thumbnailJobs.delete(file.id);
  }
}

function isValidPhone(phone) {
  return /^1[3-9]\d{9}$/.test(String(phone || ""));
}

function toast(message) {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  document.body.appendChild(node);
  window.setTimeout(() => node.classList.add("show"), 10);
  window.setTimeout(() => {
    node.classList.remove("show");
    window.setTimeout(() => node.remove(), 180);
  }, 2200);
}

function openModal(title, body) {
  modalTitle.textContent = title;
  modalBody.innerHTML = body;
  modalBackdrop.hidden = false;
}

function closeModal() {
  modalBackdrop.hidden = true;
  modalBody.innerHTML = "";
  pendingAdminAction = null;
}

function saveDatabase() {
  try {
    if (selectedCase) {
      selectedCase.updatedBy = currentUserProfile.username || currentUserProfile.contact || "未知用户";
      selectedCase.updatedAt = new Date().toLocaleString("zh-CN");
    }
    const snapshot = JSON.stringify(cases);
    localStorage.setItem(databaseKey, snapshot);
    lastDatabaseSnapshot = snapshot;
    caseDataChannel?.postMessage({ type: "cases-updated", at: Date.now() });
    scheduleRemoteCaseSync();
  } catch (error) {
    toast("浏览器本地存储空间不足，较大的图像可能无法长期保存");
  }
}

function refreshSharedCaseData(snapshot = localStorage.getItem(databaseKey), announce = false) {
  if (!snapshot || snapshot === lastDatabaseSnapshot) return false;
  try {
    const incoming = JSON.parse(snapshot);
    if (!Array.isArray(incoming)) return false;
    incoming.forEach((item) => { item.uploads = Array.isArray(item.uploads) ? item.uploads : []; });
    const selectedId = selectedCase?.id;
    cases = incoming;
    lastDatabaseSnapshot = snapshot;
    const visibleCases = getVisibleCases();
    const nextSelected = visibleCases.find((item) => item.id === selectedId) || visibleCases[0];
    renderRows();
    if (nextSelected) updateDetail(nextSelected);
    if (announce) toast("病例和上传资料已同步到最新版本");
    return true;
  } catch {
    return false;
  }
}

function sharedRequestHeaders(extra = {}) {
  return {
    "x-ovary-role": normalizeRoleType(currentUserProfile),
    "x-ovary-organization": currentUserProfile.organization || "",
    "x-ovary-user": currentUserProfile.username || currentUserProfile.contact || "",
    ...extra,
  };
}

function remoteSafeCases() {
  return cases.map((item) => ({
    ...item,
    uploads: item.uploads.map((file) => {
      const safe = { ...file };
      ["src", "convertedSrc", "videoSrc", "videoThumbSrc"].forEach((key) => {
        if (String(safe[key] || "").startsWith("data:")) safe[key] = "";
      });
      delete safe.blobId;
      return safe;
    }),
  }));
}

function scheduleRemoteCaseSync(immediate = false) {
  if (!authenticated) return;
  window.clearTimeout(remoteCaseSyncTimer);
  remoteCaseSyncTimer = window.setTimeout(async () => {
    const payloadCases = remoteSafeCases();
    const snapshot = JSON.stringify(payloadCases);
    if (!immediate && snapshot === remoteCaseSnapshot) return;
    try {
      const response = await fetch(sharedApiUrl("/api/shared-cases"), {
        method: "PUT",
        headers: sharedRequestHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ cases: payloadCases }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      remoteCaseSnapshot = snapshot;
    } catch {
      // Keep local data available; the next polling cycle retries shared synchronization.
    }
  }, immediate ? 0 : 350);
}

function mergeRemoteCaseWithLocal(remoteCase, localCase) {
  if (!localCase) return remoteCase;
  const localUploads = new Map((localCase.uploads || []).map((file) => [file.id, file]));
  const uploads = (remoteCase.uploads || []).map((remoteFile) => {
    const localFile = localUploads.get(remoteFile.id);
    if (!localFile) return remoteFile;
    const mergedFile = { ...localFile, ...remoteFile };
    ["blobId", "src", "convertedSrc", "videoSrc", "videoThumbSrc"].forEach((key) => {
      if (!remoteFile[key] && localFile[key]) mergedFile[key] = localFile[key];
    });
    if (localFile.videoThumbSrc) {
      mergedFile.videoThumbFailed = false;
      mergedFile.videoThumbVersion = localFile.videoThumbVersion || videoThumbnailVersion;
    }
    return mergedFile;
  });
  return { ...localCase, ...remoteCase, uploads };
}

async function syncCasesFromServer(announce = false) {
  if (!authenticated) return;
  try {
    const response = await fetch(sharedApiUrl("/api/shared-cases"), {
      headers: sharedRequestHeaders(),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    const remoteCases = Array.isArray(result.cases) ? result.cases : [];
    if (!remoteCases.length) {
      if (getVisibleCases().length) scheduleRemoteCaseSync(true);
      return;
    }
    remoteCases.forEach((item) => { item.uploads = Array.isArray(item.uploads) ? item.uploads : []; });
    const merged = new Map(cases.map((item) => [item.id, item]));
    remoteCases.forEach((item) => merged.set(item.id, mergeRemoteCaseWithLocal(item, merged.get(item.id))));
    const nextCases = [...merged.values()];
    const nextSnapshot = JSON.stringify(nextCases);
    if (nextSnapshot === lastDatabaseSnapshot) return;
    cases = nextCases;
    lastDatabaseSnapshot = nextSnapshot;
    localStorage.setItem(databaseKey, nextSnapshot);
    remoteCaseSnapshot = JSON.stringify(remoteSafeCases());
    const visibleCases = getVisibleCases();
    const nextSelected = visibleCases.find((item) => item.id === selectedCase?.id) || visibleCases[0];
    renderRows();
    if (nextSelected) updateDetail(nextSelected);
    if (announce) toast("已加载当前账号权限范围内的最新资料");
  } catch {
    // The local copy remains usable when the shared service is temporarily unavailable.
  }
}

async function uploadFileToSharedStorage(file, fileId) {
  try {
    const response = await fetch(sharedApiUrl(`/api/shared-files/${encodeURIComponent(fileId)}`), {
      method: "PUT",
      headers: sharedRequestHeaders({
        "content-type": file.type || "application/octet-stream",
        "x-file-name": encodeURIComponent(file.name || fileId),
      }),
      body: file,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    if (!result.url) return "";
    return new URL(result.url, sharedApiBase || window.location.origin).toString();
  } catch {
    return "";
  }
}

function getCaseOptionLabel(item) {
  return `${item.name}｜${item.id}｜${item.status}｜${item.uploads.length}份`;
}

function renderCaseSelectors() {
  const visibleCases = getVisibleCases();
  [caseSelector, uploadCaseSelector, reportCaseSelector].forEach((selector) => {
    if (!selector) return;
    selector.innerHTML = visibleCases.map((item) => `<option value="${item.id}">${escapeHtml(getCaseOptionLabel(item))}</option>`).join("");
    selector.value = selectedCase.id;
  });
}

function renderHomeUpdates() {
  const visibleCases = getVisibleCases();
  const pendingReview = visibleCases.filter((item) => item.status === "待初审").length;
  const imageCategories = getImageCategories();
  const imageFiles = visibleCases.flatMap((item) => item.uploads.filter((file) => imageCategories.includes(file.category)));
  const pendingQc = imageFiles.filter((file) => file.reviewStatus !== "已入库").length;
  const missingReports = visibleCases.filter((item) => {
    const categories = new Set(item.uploads.map((file) => file.category));
    return !categories.has("lab") || !categories.has("pathology") || !imageCategories.some((category) => categories.has(category));
  }).length;
  if (homePendingReview) homePendingReview.textContent = `${pendingReview} 条`;
  if (homePendingQc) homePendingQc.textContent = `${pendingQc} 份`;
  if (homeMissingReports) homeMissingReports.textContent = `${missingReports} 例`;
  if (homeMessageHint) {
    const messageCount = [pendingReview, pendingQc, missingReports].filter(Boolean).length;
    homeMessageHint.textContent = messageCount ? `${messageCount} 类任务待处理` : "今日暂无新消息";
  }
}

function selectCaseById(caseId, options = {}) {
  const found = getVisibleCases().find((item) => item.id === caseId);
  if (!found) return;
  selectedUploadIds.clear();
  updateDetail(found);
  renderRows();
  addUserHistory("浏览病例", `${found.id} · ${found.name}`);
  if (options.panel) showPanel(options.panel);
  if (options.tab) setCaseTab(options.tab);
}

function exportCases() {
  if (!requirePermission("export", "当前角色不能导出病例数据")) return;
  const header = ["编号", "病例", "年龄", "机构", "检查部位", "状态", "完整度", "诊断"];
  const lines = getVisibleCases().map((item) => [item.id, item.name, item.age, item.org, item.part, item.status, `${item.progress}%`, item.diagnosis].join(","));
  const blob = new Blob([`\ufeff${[header.join(","), ...lines].join("\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "卵巢平台病例数据.csv";
  link.click();
  URL.revokeObjectURL(url);
  toast("病例数据已导出");
}

function downloadTextFile(filename, text) {
  const blob = new Blob([`\ufeff${text}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function escapeWord(value) {
  return escapeHtml(value).replace(/\n/g, "<br>");
}

function downloadWordFile(filename, bodyHtml) {
  const html = `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: "Microsoft YaHei", Arial, sans-serif; color: #263238; line-height: 1.6; }
          h1 { color: #d8305a; font-size: 22px; }
          h2 { color: #263238; font-size: 16px; border-left: 4px solid #fb416b; padding-left: 8px; margin-top: 22px; }
          table { width: 100%; border-collapse: collapse; margin: 10px 0 18px; }
          th, td { border: 1px solid #f3b7c4; padding: 7px 8px; font-size: 12px; vertical-align: top; }
          th { background: #fff0f4; color: #263238; }
          .muted { color: #69777d; }
        </style>
      </head>
      <body>${bodyHtml}</body>
    </html>
  `;
  const blob = new Blob([`\ufeff${html}`], { type: "application/msword;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".doc") ? filename : `${filename}.doc`;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function readDicomText(bytes, offset, length) {
  let value = "";
  for (let index = offset; index < offset + length && index < bytes.length; index += 1) value += String.fromCharCode(bytes[index]);
  return value.replace(/\0/g, "").trim();
}

function dicomTag(group, element) {
  return `${group.toString(16).padStart(4, "0")}${element.toString(16).padStart(4, "0")}`;
}

function readUint16(view, offset, littleEndian) {
  return view.getUint16(offset, littleEndian);
}

function readUint32(view, offset, littleEndian) {
  return view.getUint32(offset, littleEndian);
}

function parseDicomNumber(value, fallback = 0) {
  const first = String(value || "").split("\\")[0].trim();
  const parsed = Number.parseFloat(first);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const dicomVrByTag = {
  "00280002": "US",
  "00280004": "CS",
  "00280006": "US",
  "00280010": "US",
  "00280011": "US",
  "00280100": "US",
  "00280101": "US",
  "00280103": "US",
  "00281050": "DS",
  "00281051": "DS",
  "00281052": "DS",
  "00281053": "DS",
};

function parseDicomElementValue(view, bytes, item, littleEndian) {
  if (item.length === 0 || item.valueOffset + item.length > bytes.length) return "";
  const vr = item.vr || dicomVrByTag[item.tag] || "";
  if (vr === "US") return view.getUint16(item.valueOffset, littleEndian);
  if (vr === "SS") return view.getInt16(item.valueOffset, littleEndian);
  if (vr === "UL") return view.getUint32(item.valueOffset, littleEndian);
  if (vr === "SL") return view.getInt32(item.valueOffset, littleEndian);
  if (vr === "FL") return view.getFloat32(item.valueOffset, littleEndian);
  if (vr === "FD") return view.getFloat64(item.valueOffset, littleEndian);
  return readDicomText(bytes, item.valueOffset, item.length);
}

function readDicomElement(view, bytes, offset, explicitVr, littleEndian) {
  if (offset + 8 > bytes.length) return null;
  const group = readUint16(view, offset, littleEndian);
  const element = readUint16(view, offset + 2, littleEndian);
  const tag = dicomTag(group, element);
  let cursor = offset + 4;
  let vr = "";
  let length = 0;
  if (explicitVr) {
    vr = readDicomText(bytes, cursor, 2);
    cursor += 2;
    if (["OB", "OD", "OF", "OL", "OW", "SQ", "UC", "UR", "UT", "UN"].includes(vr)) {
      cursor += 2;
      length = readUint32(view, cursor, littleEndian);
      cursor += 4;
    } else {
      length = readUint16(view, cursor, littleEndian);
      cursor += 2;
    }
  } else {
    length = readUint32(view, cursor, littleEndian);
    cursor += 4;
  }
  return { tag, vr, length, valueOffset: cursor, nextOffset: length === 0xffffffff ? cursor : cursor + length };
}

function parseDicom(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const bytes = new Uint8Array(arrayBuffer);
  const hasPreamble = readDicomText(bytes, 128, 4) === "DICM";
  let offset = hasPreamble ? 132 : 0;
  let transferSyntax = "1.2.840.10008.1.2.1";
  const values = {};

  while (offset + 8 <= bytes.length) {
    const group = view.getUint16(offset, true);
    if (group !== 0x0002) break;
    const item = readDicomElement(view, bytes, offset, true, true);
    if (!item || item.length === 0xffffffff || item.nextOffset > bytes.length) break;
    values[item.tag] = readDicomText(bytes, item.valueOffset, item.length);
    if (item.tag === "00020010") transferSyntax = values[item.tag];
    offset = item.nextOffset;
  }

  const explicitVr = transferSyntax !== "1.2.840.10008.1.2";
  const littleEndian = transferSyntax !== "1.2.840.10008.1.2.2";
  let pixelData = null;

  while (offset + 8 <= bytes.length) {
    const item = readDicomElement(view, bytes, offset, explicitVr, littleEndian);
    if (!item) break;
    if (item.tag === "7fe00010") {
      pixelData = {
        offset: item.valueOffset,
        length: item.length === 0xffffffff ? bytes.length - item.valueOffset : item.length,
        encapsulated: item.length === 0xffffffff || ["OB", "OW", "UN"].includes(item.vr),
      };
      break;
    }
    if (item.length === 0xffffffff || item.nextOffset <= offset || item.nextOffset > bytes.length) break;
    if (["00280002", "00280004", "00280006", "00280010", "00280011", "00280100", "00280101", "00280103", "00281050", "00281051", "00281052", "00281053"].includes(item.tag)) values[item.tag] = parseDicomElementValue(view, bytes, item, littleEndian);
    offset = item.nextOffset;
  }

  return { bytes, view, values, transferSyntax, explicitVr, littleEndian, pixelData };
}

function findEmbeddedJpeg(bytes) {
  let start = -1;
  for (let index = 0; index < bytes.length - 1; index += 1) {
    if (bytes[index] === 0xff && bytes[index + 1] === 0xd8) {
      start = index;
      break;
    }
  }
  if (start < 0) return null;
  for (let index = start + 2; index < bytes.length - 1; index += 1) {
    if (bytes[index] === 0xff && bytes[index + 1] === 0xd9) return bytes.slice(start, index + 2);
  }
  return null;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("文件读取失败"));
    reader.readAsDataURL(blob);
  });
}

function renderUncompressedDicomToJpg(parsed) {
  const { values, view, pixelData, littleEndian } = parsed;
  const rows = parseDicomNumber(values["00280010"]);
  const columns = parseDicomNumber(values["00280011"]);
  const samples = parseDicomNumber(values["00280002"], 1);
  const bitsAllocated = parseDicomNumber(values["00280100"], 16);
  const bitsStored = parseDicomNumber(values["00280101"], bitsAllocated);
  const signed = parseDicomNumber(values["00280103"], 0) === 1;
  const planar = parseDicomNumber(values["00280006"], 0);
  const photometric = String(values["00280004"] || "MONOCHROME2").toUpperCase();
  const slope = parseDicomNumber(values["00281053"], 1) || 1;
  const intercept = parseDicomNumber(values["00281052"], 0);
  const windowCenter = parseDicomNumber(values["00281050"], Number.NaN);
  const windowWidth = parseDicomNumber(values["00281051"], Number.NaN);

  if (!rows || !columns || !pixelData) throw new Error("DICOM 缺少行列或像素数据");
  if (![8, 16].includes(bitsAllocated)) throw new Error(`暂不支持 ${bitsAllocated} bit DICOM 像素`);
  if (![1, 3].includes(samples)) throw new Error(`暂不支持 ${samples} 通道 DICOM 图像`);

  const canvas = document.createElement("canvas");
  canvas.width = columns;
  canvas.height = rows;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(columns, rows);
  const data = image.data;
  const pixelOffset = pixelData.offset;
  const pixelCount = rows * columns;
  const bytesPerSample = bitsAllocated / 8;
  const mask = bitsStored < bitsAllocated ? (1 << bitsStored) - 1 : null;

  if (samples === 3 && bitsAllocated === 8) {
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      let rIndex;
      let gIndex;
      let bIndex;
      if (planar === 1) {
        rIndex = pixelOffset + pixel;
        gIndex = pixelOffset + pixelCount + pixel;
        bIndex = pixelOffset + pixelCount * 2 + pixel;
      } else {
        rIndex = pixelOffset + pixel * 3;
        gIndex = rIndex + 1;
        bIndex = rIndex + 2;
      }
      let red = view.getUint8(rIndex);
      let green = view.getUint8(gIndex);
      let blue = view.getUint8(bIndex);
      if (photometric.startsWith("YBR")) {
        const y = red;
        const cb = green - 128;
        const cr = blue - 128;
        red = y + 1.402 * cr;
        green = y - 0.344136 * cb - 0.714136 * cr;
        blue = y + 1.772 * cb;
      }
      const target = pixel * 4;
      data[target] = Math.max(0, Math.min(255, red));
      data[target + 1] = Math.max(0, Math.min(255, green));
      data[target + 2] = Math.max(0, Math.min(255, blue));
      data[target + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.95);
  }

  const valuesForWindow = new Float32Array(pixelCount);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixelOffset + pixel * bytesPerSample;
    let value = bitsAllocated === 8 ? (signed ? view.getInt8(offset) : view.getUint8(offset)) : signed ? view.getInt16(offset, littleEndian) : view.getUint16(offset, littleEndian);
    if (mask) {
      value &= mask;
      if (signed && value & (1 << (bitsStored - 1))) value -= 1 << bitsStored;
    }
    value = value * slope + intercept;
    valuesForWindow[pixel] = value;
    if (value < min) min = value;
    if (value > max) max = value;
  }

  const hasWindow = Number.isFinite(windowCenter) && Number.isFinite(windowWidth) && windowWidth > 1;
  const low = hasWindow ? windowCenter - 0.5 - (windowWidth - 1) / 2 : min;
  const high = hasWindow ? windowCenter - 0.5 + (windowWidth - 1) / 2 : max;
  const range = high > low ? high - low : 1;
  const invert = photometric.includes("MONOCHROME1");
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    let gray = ((valuesForWindow[pixel] - low) / range) * 255;
    gray = Math.max(0, Math.min(255, gray));
    if (invert) gray = 255 - gray;
    const target = pixel * 4;
    data[target] = gray;
    data[target + 1] = gray;
    data[target + 2] = gray;
    data[target + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.95);
}

async function createDicomJpgDataUrl(file) {
  const arrayBuffer = await file.arrayBuffer();
  const parsed = parseDicom(arrayBuffer);
  const embeddedJpeg = findEmbeddedJpeg(parsed.bytes);
  if (embeddedJpeg) {
    return {
      src: await blobToDataUrl(new Blob([embeddedJpeg], { type: "image/jpeg" })),
      name: file.name.replace(/\.(dcm|dicom)$/i, ".jpg"),
      meta: "已提取 DICOM 内嵌 JPEG 图像",
    };
  }
  const compressedSyntax = !["1.2.840.10008.1.2", "1.2.840.10008.1.2.1", "1.2.840.10008.1.2.2"].includes(parsed.transferSyntax);
  if (compressedSyntax) throw new Error(`当前浏览器暂不支持该压缩 DICOM：${parsed.transferSyntax}`);
  return {
    src: renderUncompressedDicomToJpg(parsed),
    name: file.name.replace(/\.(dcm|dicom)$/i, ".jpg"),
    meta: "已按 DICOM 像素数据生成 JPG",
  };
}

function dataUrlToBlob(dataUrl) {
  const [meta, data] = dataUrl.split(",");
  const mime = meta.match(/data:(.*?);/)?.[1] || "application/octet-stream";
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mime });
}

async function downloadUrl(url, filename) {
  const objectUrl = url.startsWith("data:") ? URL.createObjectURL(dataUrlToBlob(url)) : url;
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  if (objectUrl !== url) window.setTimeout(() => URL.revokeObjectURL(objectUrl), 500);
}

function downloadTemplate() {
  downloadTextFile(
    "卵巢平台上传模板.csv",
    [
      "病例编号,资料类型,超声分类,文件名,是否必填,备注",
      "CASE-2026-001,基本信息,,case-info.jpg,是,机构编号/机构名称/检查时间/仪器品牌型号",
      "CASE-2026-001,临床信息,,clinical.png,是,年龄/BMI/月经婚育史/家族史/既往治疗史",
      "CASE-2026-001,超声图像,灰阶超声,example.dcm,是,4-20张；单张200KB-2MB",
      "CASE-2026-001,超声图像,彩色多普勒超声,example.jpg,是,1-5张；单张200KB-2MB",
      "CASE-2026-001,超声图像,频谱/三维/造影/弹性,optional.jpg,否,各类0-5张",
      "CASE-2026-001,动态视频,,dynamic.avi,是,1-5段；平均约400MB/段",
      "CASE-2026-001,超声报告,,report.jpg,是,图片格式",
      "CASE-2026-001,超声报告,O-RADS分级,ultrasound.png,是,O-RADS 0-5",
      "CASE-2026-001,检验结果-肿瘤标志物,,tumor-marker.png,是,CA125/HE4/AFP/CEA/CA199/CA153/SCC",
      "CASE-2026-001,病理报告,,pathology.jpg,是,支持JPEG/JPG/PNG/DICOM/DCM/AVI",
      "CASE-2026-001,随访结果,,followup.dcm,否,病例提交后可再次编辑",
    ].join("\n"),
  );
  toast("上传模板已下载");
}

function downloadReportTemplate() {
  downloadTextFile(
    "卵巢平台报告模板.csv",
    [
      "病例编号,报告类型,报告日期,文件名,关键指标/结论,审核状态",
      "CASE-2026-001,检验结果-肿瘤标志物,2026-07-09,tumor-marker.png,CA125/HE4/AFP/CEA/CA199/CA153/SCC,待初审",
      "CASE-2026-001,病理报告,2026-07-09,pathology.jpg,病理诊断结论,待初审",
      "CASE-2026-001,CT / MRI / 核医学,2026-07-09,ct.dcm,影像诊断结论,待初审",
      "CASE-2026-001,随访结果,2026-07-09,followup.png,复查实验室和超声结果,待初审",
      "CASE-2026-001,其他,2026-07-09,other.jpg,补充说明,待初审",
    ].join("\n"),
  );
  toast("报告模板已下载");
}

function exportLedger() {
  if (!requirePermission("export", "当前角色不能导出台账")) return;
  const rows = getVisibleCases()
    .map((item) => {
      const uploadCount = item.uploads.length;
      const storedCount = item.uploads.filter((file) => file.stored).length;
      const imageCount = item.uploads.filter((file) => getImageCategories().includes(file.category)).length;
      return `<tr><td>${escapeWord(item.id)}</td><td>${escapeWord(item.name)}</td><td>${escapeWord(item.org)}</td><td>${escapeWord(item.status)}</td><td>${imageCount}</td><td>${uploadCount}</td><td>${storedCount}</td><td>${item.progress}%</td><td>${escapeWord(item.diagnosis)}</td></tr>`;
    })
    .join("");
  downloadWordFile(
    "卵巢平台完整性台账.doc",
    `
      <h1>卵巢平台完整性台账</h1>
      <p class="muted">导出时间：${new Date().toLocaleString("zh-CN")}</p>
      <table>
        <thead><tr><th>病例编号</th><th>病例</th><th>机构</th><th>状态</th><th>影像数</th><th>上传总数</th><th>入库文件数</th><th>完整度</th><th>诊断</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `,
  );
  toast("完整性台账 Word 已导出");
}

function openNewCaseModal() {
  if (!requirePermission("create_case", "当前角色不能新建病例")) return;
  const organizations = [currentUserProfile.organization || "总PI单位"];
  openModal(
    "新建病例",
    `
      <form class="modal-form" id="newCaseForm">
        <label>年龄<input name="age" required type="number" min="1" max="120" placeholder="请输入年龄" /></label>
        <label>上传机构<select name="org" required>${organizations.map((item) => `<option>${escapeHtml(item)}</option>`).join("")}</select></label>
        <label>检查部位<select name="part"><option>卵巢</option><option>附件区</option><option>盆腔</option></select></label>
        <label class="full">临床诊断<input name="diagnosis" required placeholder="请输入初步诊断" /></label>
        <label>检查日期<input name="examDate" required type="date" /></label>
        <label>仪器品牌型号<input name="equipment" required placeholder="请输入仪器信息" /></label>
        <label>月经婚育史<input name="reproductiveHistory" required placeholder="请填写月经婚育史" /></label>
        <label>家族史<input name="familyHistory" required placeholder="无则填“无”" /></label>
        <label class="full">既往治疗史<input name="treatmentHistory" required placeholder="无则填“无”" /></label>
        <div class="modal-actions">
          <button class="ghost modal-cancel" type="button">取消</button>
          <button class="primary" type="submit">保存病例</button>
        </div>
      </form>
    `,
  );
}

function startUpload(request = {}) {
  if (!requirePermission("upload", "当前角色没有上传权限")) return;
  const nextRequest = {
    target: request.target || "病例资料",
    category: request.category || "other",
    scan: request.scan || "",
  };
  if (!canUploadToSelectedCase()) {
    pendingUploadRequest = nextRequest;
    openNewCaseModal();
    toast("请先建立本院病例，保存后将自动打开文件选择");
    return;
  }
  uploadTarget = nextRequest.target;
  uploadCategory = nextRequest.category;
  if (nextRequest.scan) setScan(nextRequest.scan);
  fileInput.accept = getImageCategories().includes(uploadCategory)
    ? ".jpg,.jpeg,.png,.dcm,.dicom,.avi,image/jpeg,image/png,application/dicom,video/avi,video/x-msvideo"
    : ".jpg,.jpeg,.png,.dcm,.dicom,.avi,.pdf,.doc,.docx,image/jpeg,image/png,application/dicom,video/avi,video/x-msvideo,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  fileInput.value = "";
  fileInput.click();
  toast(`准备上传：${uploadTarget}`);
}

function startRoleUpload(button) {
  const stage = button.closest("[data-workflow-stage]")?.dataset.workflowStage || "initial";
  if (stage === "report") {
    startUpload({ target: "报告资料", category: "other" });
    return;
  }
  if (stage === "quality") {
    startUpload({ target: scanTypes[activeScan].title, category: activeScan, scan: activeScan });
    return;
  }
  const activeTab = document.querySelector(".tab.active")?.dataset.tab || "ultrasound";
  if (activeTab === "ultrasound") {
    startUpload({ target: scanTypes[activeScan].title, category: activeScan, scan: activeScan });
    return;
  }
  const labels = {
    history: "病史附件",
    lab: "检验结果",
    pathology: "病理报告",
    ct: "CT / MRI / 核医学",
    followup: "随访资料",
    other: "其他资料",
  };
  startUpload({ target: labels[activeTab] || "病例资料", category: activeTab });
}

function previewLatestUpload(stage = "initial") {
  const uploads = selectedCase?.uploads || [];
  let file = null;
  if (stage === "quality") file = uploads.find((item) => getImageCategories().includes(item.category));
  if (!file) file = uploads[0];
  if (!file) {
    toast("当前病例暂无可预览文件，请先上传资料");
    return;
  }
  openPreview(file.id);
}

async function downloadCurrentCaseFiles() {
  const uploads = selectedCase?.uploads || [];
  if (!uploads.length) {
    toast("当前病例暂无可下载文件，请先上传资料");
    return;
  }
  for (const file of uploads) {
    await downloadUploadPreview(file.id);
  }
}

function openMessagesModal() {
  openModal(
    "消息提醒",
    `
      <div class="message-list">
        <div><strong>退审提醒</strong><span>CASE-2026-073 需补充病理报告。</span></div>
        <div><strong>上传完成</strong><span>灰阶超声 DICOM 已转换为 JPG 预览。</span></div>
        <div><strong>质控通知</strong><span>3 条病例已进入待质控队列。</span></div>
      </div>
    `,
  );
}

function showPanel(panelId) {
  if (!canAccessPanel(panelId)) {
    toast("当前角色不能访问该页面");
    return;
  }
  if (["casePanel", "uploadPanel", "reportPanel"].includes(panelId) && !getVisibleCases().length) {
    if (hasPermission("create_case")) {
      openNewCaseModal();
      toast("当前权限范围内暂无病例，请先新建病例");
    } else {
      toast("当前医院暂无可查看病例，请联系普通用户或主体管理员上传资料");
    }
    return;
  }
  document.querySelectorAll(".view-panel").forEach((panel) => panel.classList.toggle("active", panel.id === panelId));
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.panel === panelId));
  renderCaseSelectors();
  if (panelId === "reportPanel") {
    renderReportFiles();
    renderReportMatrix();
  }
  if (panelId === "uploadPanel") renderImageQualitySummary();
  if (panelId === "configPanel" || panelId === "adminUsersPanel") renderAdminDashboard();
}

function statusClass(status) {
  if (status === "退审中" || status === "不认可数据" || status === "作废数据") return "color: var(--red)";
  if (status === "已入库") return "color: var(--green)";
  if (["初审中", "待质控", "质控中", "待入库"].includes(status)) return "color: var(--amber)";
  return "color: var(--cyan)";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderProfileHistory() {
  const username = currentUserProfile.username || currentUserProfile.contact;
  const list = getUserHistory().filter((item) => item.username === username);
  return list.length
    ? list.map((item) => `<li><strong>${escapeHtml(item.type)}</strong><span>${escapeHtml(item.detail)}</span><em>${escapeHtml(item.time)}</em></li>`).join("")
    : "<li><strong>暂无记录</strong><span>登录、浏览病例、审批操作会在这里显示。</span><em>-</em></li>";
}

function renderApprovalRecords() {
  const rows = getVisibleCases()
    .filter((item) => ["待质控", "质控中", "待入库", "已入库", "退审中", "不认可数据", "作废数据"].includes(item.status) || item.uploads.some((file) => file.reviewStatus === "已入库"))
    .slice(0, 8)
    .map((item) => `<li><strong>${escapeHtml(item.id)}</strong><span>${escapeHtml(item.name)} · ${escapeHtml(item.status)}</span><em>${item.progress}%</em></li>`);
  return rows.length ? rows.join("") : "<li><strong>暂无审批记录</strong><span>完成入库、退审或复审后会自动汇总。</span><em>-</em></li>";
}

function roleScopeDescription(profile = currentUserProfile) {
  const descriptions = {
    uploader: "可新建本人病例、向本院授权病例上传和补充资料、预览下载文件并查看状态；不可审核、入库、管理用户或跨院查看。",
    quality_reviewer: "可查看本院病例和普通用户的最新资料，上传补充、预览下载并执行初审、影像质控、退回和问题标记；不可管理用户、配置系统或最终入库。",
    organization_admin: "可查看并补充本医院全部病例资料，预览下载，管理本院用户、操作记录、导出和最终入库；不可查看其他医院明细。",
    platform_admin: "仅限总PI单位，可查看、质检、审核、退回、预览和下载全部医院资料，并管理主体、四级角色、跨院统计、配置、审计、导出和归档；新增病例和上传资料仅限本单位。",
  };
  return descriptions[normalizeRoleType(profile)] || descriptions.uploader;
}

function openProfileModal() {
  const user = currentUserProfile;
  openModal(
    "个人中心",
    `
      <div class="profile-center">
        <section class="profile-head">
          <div class="profile-avatar">${user.avatar ? `<img src="${user.avatar}" alt="" />` : escapeHtml((user.contact || user.username || "管").slice(0, 1))}</div>
          <div>
            <h3>${escapeHtml(user.contact || user.username || "管理员")}</h3>
            <p>${escapeHtml(roleLabel(user))} · ${escapeHtml(user.organization || "-")} · ${escapeHtml(user.department || "-")}</p>
          </div>
        </section>
        <form id="profileForm" class="profile-form">
          <label>用户名<input name="username" readonly value="${escapeHtml(user.username || "")}" /></label>
          <label>账号角色<input name="role" readonly value="${escapeHtml(roleLabel(user))}" /></label>
          <label>姓名<input name="contact" required value="${escapeHtml(user.contact || "")}" /></label>
          <label>手机号<input name="phone" required pattern="^1[3-9]\\d{9}$" value="${escapeHtml(user.phone || "")}" /></label>
          <label>所属机构<input name="organization" readonly value="${escapeHtml(user.organization || "")}" /></label>
          <label>科室<select name="department">
            ${["超声科", "超声医学科", "科研管理办公室"].map((item) => `<option ${item === user.department ? "selected" : ""}>${item}</option>`).join("")}
          </select></label>
          <label>职称<select name="title">
            ${["主任医师", "副主任医师", "主治医师", "住院医师", "技师", "研究员"].map((item) => `<option ${item === user.title ? "selected" : ""}>${item}</option>`).join("")}
          </select></label>
          <label>更换头像<input name="avatar" type="file" accept="image/*" /></label>
          <label class="full">权限范围<input readonly value="${escapeHtml(roleScopeDescription(user))}" /></label>
          <div class="modal-actions">
            <button class="ghost modal-cancel" type="button">关闭</button>
            <button class="primary" type="submit">保存资料</button>
          </div>
        </form>
        <section class="profile-records">
          <div>
            <h3>浏览记录</h3>
            <ul>${renderProfileHistory()}</ul>
          </div>
          <div>
            <h3>审批记录</h3>
            <ul>${renderApprovalRecords()}</ul>
          </div>
        </section>
      </div>
    `,
  );
}

function highlightText(value) {
  const safe = escapeHtml(value);
  if (!activeQuery) return safe;
  const pattern = new RegExp(`(${escapeRegExp(activeQuery)})`, "gi");
  return safe.replace(pattern, '<mark class="search-hit">$1</mark>');
}

function getFilteredCases() {
  const part = partFilter?.value || "全部";
  const org = orgFilter?.value || "全部";
  const hidden = hiddenFilter?.value || "全部";
  const keyword = activeQuery.toLowerCase();
  return getVisibleCases().filter((item) => {
    if (item.status !== activeStatus) return false;
    if (queryApplied && part !== "全部" && item.part !== part) return false;
    if (queryApplied && org !== "全部" && item.org !== org) return false;
    if (queryApplied && hidden === "未隐藏" && item.hidden) return false;
    if (queryApplied && hidden === "已隐藏" && !item.hidden) return false;
    if (!keyword) return true;
    const haystack = [item.id, item.name, item.age, item.org, item.part, item.status, item.diagnosis].join(" ").toLowerCase();
    return haystack.includes(keyword);
  });
}

function updateQuerySummary(total) {
  if (!querySummary) return;
  if (!queryApplied && !activeQuery) {
    querySummary.hidden = true;
    querySummary.textContent = "";
    return;
  }
  const bits = [`状态：${activeStatus}`];
  if (partFilter?.value && partFilter.value !== "全部") bits.push(`检查部位：${partFilter.value}`);
  if (orgFilter?.value && orgFilter.value !== "全部") bits.push(`上传机构：${orgFilter.value}`);
  if (hiddenFilter?.value && hiddenFilter.value !== "全部") bits.push(`隐藏状态：${hiddenFilter.value}`);
  if (activeQuery) bits.push(`关键词：${activeQuery}`);
  querySummary.hidden = false;
  querySummary.innerHTML = `查询结果 ${total} 条<span>${bits.map(escapeHtml).join(" / ")}</span>`;
}

function updateStatusCounts() {
  const counts = getVisibleCases().reduce((result, item) => {
    result[item.status] = (result[item.status] || 0) + 1;
    return result;
  }, {});
  statusCards.forEach((card) => {
    const countNode = card.querySelector("strong");
    if (countNode) countNode.textContent = counts[card.dataset.status] || 0;
  });
}

function renderRows() {
  updateStatusCounts();
  renderCaseSelectors();
  renderHomeUpdates();
  const list = getFilteredCases();
  if (!list.length) {
    rows.innerHTML = '<tr><td class="empty-row" colspan="10">未查询到符合条件的数据，请调整筛选条件后重试。</td></tr>';
    updateSelectedCount();
    updateQuerySummary(0);
    applyRolePermissions();
    return;
  }
  rows.innerHTML = list
    .map(
      (item) => `
        <tr class="${item.id === selectedCase.id ? "selected" : ""}" data-id="${item.id}">
          <td><input class="case-check" type="checkbox" data-id="${item.id}" ${selectedIds.has(item.id) ? "checked" : ""} aria-label="选择 ${item.id}" /></td>
          <td>${highlightText(item.id)}</td>
          <td>${highlightText(item.name)}</td>
          <td>${item.age}</td>
          <td>${highlightText(item.org)}</td>
          <td>${highlightText(item.part)}</td>
          <td>${highlightText(item.diagnosis)}</td>
          <td><div class="progress" aria-label="完整度 ${item.progress}%"><span style="width:${item.progress}%"></span></div></td>
          <td style="${statusClass(item.status)}">${item.status}</td>
          <td><button class="row-action" type="button" data-id="${item.id}">查看</button></td>
        </tr>
      `,
    )
    .join("");
  updateSelectedCount();
  updateQuerySummary(list.length);
  applyRolePermissions();
}

function createDeleteButton() {
  const button = document.createElement("button");
  button.className = "delete-file";
  button.type = "button";
  button.textContent = "删除";
  return button;
}

const sectionFormDefaults = {};

function getSectionControls(sectionId) {
  return [...document.querySelectorAll(`#${sectionId} input:not([type="file"]), #${sectionId} select, #${sectionId} textarea`)];
}

function getSectionControlKey(control, index) {
  return control.dataset.caseField || control.name || `${control.tagName.toLowerCase()}-${index}`;
}

function readSectionForm(sectionId) {
  return Object.fromEntries(getSectionControls(sectionId).map((control, index) => {
    const value = ["checkbox", "radio"].includes(control.type) ? control.checked : control.value;
    return [getSectionControlKey(control, index), value];
  }));
}

function applySectionForm(sectionId, values = {}) {
  getSectionControls(sectionId).forEach((control, index) => {
    const key = getSectionControlKey(control, index);
    if (!(key in values)) return;
    if (["checkbox", "radio"].includes(control.type)) control.checked = Boolean(values[key]);
    else control.value = values[key] ?? "";
  });
}

function hydrateCaseForms(item) {
  ["history", "ct", "followup"].forEach((sectionId) => {
    if (!sectionFormDefaults[sectionId]) sectionFormDefaults[sectionId] = readSectionForm(sectionId);
    applySectionForm(sectionId, sectionFormDefaults[sectionId]);
  });
  applySectionForm("history", {
    ...(item.historyForm || {}),
    ...(item.historyForm?.examDate ? {} : { examDate: item.examDate || sectionFormDefaults.history.examDate }),
    ...(item.historyForm?.equipment ? {} : { equipment: item.equipment || sectionFormDefaults.history.equipment }),
  });
  applySectionForm("ct", item.ctForm || {});
  applySectionForm("followup", item.followupForm || {});
}

function saveCaseSection(sectionId) {
  if (!canEditSelectedCase()) {
    toast(isPlatformAdmin() ? "平台管理员只能修改本单位病例资料" : "当前账号不能修改该病例");
    return;
  }
  const propertyBySection = {
    history: "historyForm",
    ct: "ctForm",
    followup: "followupForm",
  };
  const labelBySection = {
    history: "病史",
    ct: "CT / MRI / 核医学报告文字",
    followup: "随访",
  };
  const property = propertyBySection[sectionId];
  if (!property) return;
  selectedCase[property] = readSectionForm(sectionId);
  if (sectionId === "history") {
    selectedCase.examDate = selectedCase[property].examDate || "";
    selectedCase.equipment = selectedCase[property].equipment || "";
  }
  saveDatabase();
  addUserHistory("资料保存", `${selectedCase.id} ${labelBySection[sectionId]}数据已更新`);
  updateDetail(selectedCase);
  renderRows();
  toast(`${labelBySection[sectionId]}数据已保存`);
}

function updateDetail(item) {
  if (selectedCase?.id && selectedCase.id !== item.id) selectedUploadIds.clear();
  selectedCase = item;
  document.querySelector("#detailTitle").textContent = item.id;
  document.querySelector("#detailMeta").textContent = `${item.org} · ${item.part} · ${item.status}${item.updatedAt ? ` · 最近由 ${item.updatedBy || "未知用户"} 更新于 ${item.updatedAt}` : ""}`;
  document.querySelector("#patientName").textContent = item.name;
  document.querySelector("#patientAge").textContent = item.age;
  document.querySelector("#patientDiagnosis").textContent = item.diagnosis;
  document.querySelector("#patientProgress").textContent = `${item.progress}%`;
  hydrateCaseForms(item);
  if (uploadLibraryMeta) uploadLibraryMeta.textContent = `${item.id} · ${item.name} · ${item.uploads.length} 份资料${item.updatedAt ? ` · 最近更新：${item.updatedBy || "未知用户"} ${item.updatedAt}` : ""}`;
  renderCaseSelectors();
  renderUploadViews();
  applyRolePermissions();
}

function setCaseTab(tabId) {
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === tabId));
  document.querySelectorAll(".tab-content").forEach((content) => content.classList.toggle("active", content.id === tabId));
}

function setScan(scanId) {
  activeScan = scanId;
  const scan = scanTypes[scanId];
  document.querySelectorAll(".mini-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.scan === scanId));
  document.querySelector("#scanTitle").textContent = scan.title;
  document.querySelector("#scanNote").textContent = scan.note;

  renderUploadViews();
}

function isAcceptedUpload(file) {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  const acceptedImage = (
    name.endsWith(".jpg") ||
    name.endsWith(".jpeg") ||
    name.endsWith(".png") ||
    name.endsWith(".dcm") ||
    name.endsWith(".dicom") ||
    name.endsWith(".avi") ||
    type === "image/jpeg" ||
    type === "image/png" ||
    type === "application/dicom" ||
    type === "video/avi" ||
    type === "video/x-msvideo"
  );
  if (getImageCategories().includes(uploadCategory)) return acceptedImage;
  return acceptedImage ||
    name.endsWith(".pdf") ||
    name.endsWith(".doc") ||
    name.endsWith(".docx") ||
    type === "application/pdf" ||
    type === "application/msword" ||
    type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

function isDicomFile(file) {
  const name = file.name.toLowerCase();
  return name.endsWith(".dcm") || name.endsWith(".dicom") || file.type.toLowerCase() === "application/dicom";
}

function isRasterImageFile(file) {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".png") || type === "image/jpeg" || type === "image/png";
}

function isVideoFile(file) {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return name.endsWith(".avi") || type === "video/avi" || type === "video/x-msvideo";
}

async function addFiles(files) {
  if (!canUploadToSelectedCase()) {
    toast("当前账号不能向该病例上传资料");
    return;
  }
  const incoming = [...files];
  const accepted = incoming.filter(isAcceptedUpload);
  let rejected = incoming.length - accepted.length;
  let added = 0;
  let cloudShareUnavailable = false;
  if (!accepted.length) {
    toast(getImageCategories().includes(uploadCategory)
      ? "超声图像仅支持 JPEG、JPG、PNG、DICOM/DCM、AVI 格式"
      : "该资料支持 JPG、PNG、DICOM/DCM、AVI、PDF、Word（DOC/DOCX）格式");
    return;
  }
  for (const file of accepted) {
    uploadCounter += 1;
    const uploadId = `upload-${Date.now()}-${uploadCounter}`;
    const dicom = isDicomFile(file);
    const isImage = isRasterImageFile(file) && !dicom;
    const isVideo = isVideoFile(file);
    const isDocument = !dicom && !isImage && !isVideo;
    const category = uploadCategory || activeScan;
    const label = scanTypes[category]?.title || uploadTarget;
    let converted = null;
    if (dicom) {
      try {
        converted = await createDicomJpgDataUrl(file);
      } catch (error) {
        rejected += 1;
        toast(`${file.name} 转换失败：${error.message}`);
        continue;
      }
    }
    const remoteUrl = await uploadFileToSharedStorage(file, uploadId);
    if (!remoteUrl) cloudShareUnavailable = true;
    const imageSrc = isImage ? remoteUrl || await blobToDataUrl(file) : "";
    const blobId = (isVideo || isDocument) ? `blob-${Date.now()}-${uploadCounter}` : "";
    let videoThumbSrc = "";
    let convertedSrc = converted?.src || "";
    if (converted?.src) {
      const convertedFile = new File(
        [dataUrlToBlob(converted.src)],
        converted.name || `${file.name}.jpg`,
        { type: "image/jpeg" },
      );
      convertedSrc = await uploadFileToSharedStorage(convertedFile, `${uploadId}-preview`) || converted.src;
    }
    if (isVideo || isDocument) {
      try {
        await storeUploadBlob(blobId, file, { name: file.name, type: file.type || (isVideo ? "video/x-msvideo" : "application/octet-stream") });
        if (isVideo) {
          try {
            videoThumbSrc = await createVideoThumbnail(file, file.name);
          } catch {
            videoThumbSrc = "";
          }
        }
      } catch (error) {
        rejected += 1;
        toast(`${file.name} 保存失败：${error.message}`);
        continue;
      }
    }
    selectedCase.uploads.unshift({
      id: uploadId,
      blobId,
      remoteUrl,
      category,
      label,
      name: file.name,
      kind: dicom ? "dicom" : isImage ? "image" : isVideo ? "video" : "file",
      src: imageSrc,
      videoSrc: isVideo ? remoteUrl : "",
      videoThumbSrc,
      videoThumbFailed: isVideo && !videoThumbSrc,
      videoThumbVersion: isVideo ? videoThumbnailVersion : 0,
      convertedSrc,
      convertedName: converted?.name || "",
      dicomMeta: converted?.meta || "",
      stored: false,
      reviewStatus: "待初审",
      converted: dicom,
      uploadedBy: currentUserProfile.username || currentUserProfile.contact,
      uploadedAt: new Date().toLocaleString("zh-CN"),
    });
    added += 1;
  }
  if (added <= 0) return;
  selectedCase.progress = Math.min(100, selectedCase.progress + added * 8);
  saveDatabase();
  updateDetail(selectedCase);
  renderRows();
  if (cloudShareUnavailable) {
    toast(`${uploadTarget}已保存到当前浏览器；严格免费模式下文件不会跨设备共享`);
  } else {
    toast(rejected ? `${uploadTarget}已上传，${rejected} 个非支持格式已忽略；可预览或下载已上传文件` : `${uploadTarget}已上传，可预览或下载已上传文件`);
  }
}

function renderUploadViews() {
  if (!imageGrid || !selectedCase) return;
  const scan = scanTypes[activeScan];
  const currentScanUploads = selectedCase.uploads.filter((file) => file.category === activeScan);
  imageGrid.innerHTML = currentScanUploads.length
    ? currentScanUploads.map(renderUploadFigure).join("")
    : `<div class="empty-state scan-empty">${scan.empty}</div>`;

  if (uploadList) {
    uploadList.innerHTML = selectedCase.uploads.length
      ? selectedCase.uploads.map(renderUploadRow).join("")
      : '<div class="empty-state">当前病例暂无影像资料，请进入病例查看的“超声图像”页签上传。</div>';
  }
  renderReportFiles();
  renderReportMatrix();
  renderImageQualitySummary();
  if (uploadLibraryMeta) uploadLibraryMeta.textContent = `${selectedCase.id} · ${selectedCase.name} · ${selectedCase.uploads.length} 份资料`;
  selectedCase.uploads.filter((file) => file.kind === "video" && !file.videoThumbSrc).forEach(ensureVideoThumbnail);
  applyRolePermissions();
}

function renderUploadFigure(file) {
  const previewSrc = file.kind === "dicom" ? file.convertedSrc : file.kind === "video" ? file.videoThumbSrc || file.videoSrc : file.src;
  const hasDownload = file.kind === "video" || Boolean(previewSrc);
  const downloadLabel = file.converted ? "下载JPG" : file.kind === "video" ? "下载原文件" : "下载原图";
  const preview =
    file.kind === "image"
      ? `<button class="preview-button" data-preview-id="${file.id}" type="button" aria-label="放大预览 ${file.name}"><img src="${file.src}" alt="${file.name}" /></button>`
      : file.kind === "dicom"
        ? `<button class="dicom-preview preview-button" data-preview-id="${file.id}" type="button" aria-label="放大预览 ${file.convertedName}"><img src="${previewSrc}" alt="${file.convertedName}" /><span>DICOM/DCM 已自动转换为 JPG 预览</span></button>`
        : file.kind === "video"
          ? `<button class="video-preview preview-button" data-preview-id="${file.id}" type="button" aria-label="播放预览 ${file.name}">${file.videoThumbSrc ? `<img src="${file.videoThumbSrc}" alt="${file.name} 第 1 秒预览画面" />` : renderAviThumb(file)}<span>${file.videoThumbSrc ? "第 1 秒预览画面" : "AVI 动态视频已上传"}</span></button>`
          : `<div class="empty-state">附件已上传</div>`;
  return `
    <figure class="${selectedUploadIds.has(file.id) ? "selected-upload" : ""}" data-upload-id="${file.id}" data-scan-card="${file.category}">
      <div class="preview-actions">
        <label class="upload-select"><input class="upload-check" type="checkbox" data-upload-id="${file.id}" ${selectedUploadIds.has(file.id) ? "checked" : ""} />选择</label>
        <button class="delete-file" data-upload-id="${file.id}" type="button">删除</button>
      </div>
      <div class="preview-frame">${preview}</div>
      <figcaption>
        <span>${file.label} · ${file.name} · ${file.reviewStatus || (file.stored ? "已入库" : "待初审")} · 上传人：${escapeHtml(file.uploadedBy || "未知用户")} · ${escapeHtml(file.uploadedAt || "-")} · 点击图像预览</span>
        ${hasDownload ? `<button class="download-file" data-download-id="${file.id}" type="button">${downloadLabel}</button>` : ""}
      </figcaption>
    </figure>
  `;
}

function renderUploadRow(file) {
  const status = file.converted ? "已自动转 JPG" : file.reviewStatus || (file.stored ? "已入库" : "待初审");
  const thumbSrc = file.converted ? file.convertedSrc : file.kind === "image" ? file.src : file.kind === "video" ? file.videoThumbSrc || file.videoSrc : "";
  const hasPreview = file.kind === "video" || Boolean(thumbSrc);
  const hasDownload = file.kind === "file" || hasPreview;
  const downloadLabel = file.converted ? "下载JPG" : ["video", "file"].includes(file.kind) ? "下载原文件" : "下载原图";
  return `
    <div class="upload-row ${selectedUploadIds.has(file.id) ? "selected-upload" : ""}" data-upload-id="${file.id}">
      <input class="upload-check" type="checkbox" data-upload-id="${file.id}" ${selectedUploadIds.has(file.id) ? "checked" : ""} aria-label="选择 ${file.name}" />
      <span>${file.label}</span>
      <strong>${file.name}</strong>
      <em>${status} · 上传人：${escapeHtml(file.uploadedBy || "未知用户")} · ${escapeHtml(file.uploadedAt || "-")}${file.reviewNote ? ` · 问题：${escapeHtml(file.reviewNote)}` : ""}${hasPreview ? " · 点击缩略图预览" : ""}</em>
      ${hasPreview ? `<button class="row-thumb" data-preview-id="${file.id}" type="button" aria-label="预览 ${file.convertedName || file.name}">${file.kind === "video" ? (file.videoThumbSrc ? `<img src="${file.videoThumbSrc}" alt="${file.name} 第 1 秒预览画面" />` : (thumbSrc ? `<video src="${thumbSrc}" muted></video>` : renderAviThumb(file))) : `<img src="${thumbSrc}" alt="${file.convertedName || file.name}" />`}</button>` : ""}
      ${hasDownload ? `<button class="download-file inline" data-download-id="${file.id}" type="button">${downloadLabel}</button>` : ""}
      <button class="delete-file inline" data-upload-id="${file.id}" type="button">删除</button>
    </div>
  `;
}

function findUpload(uploadId) {
  return selectedCase.uploads.find((file) => file.id === uploadId);
}

async function openPreview(uploadId) {
  const file = findUpload(uploadId);
  if (!file) return;
  const src = file.converted ? file.convertedSrc : file.src;
  let videoSrc = file.kind === "video" ? file.videoSrc : "";
  let objectUrl = "";
  if (file.kind === "video" && !videoSrc) {
    try {
      const record = await getUploadBlob(file.blobId);
      if (record?.blob) {
        objectUrl = URL.createObjectURL(record.blob);
        videoSrc = objectUrl;
      }
    } catch {
      videoSrc = "";
    }
  }
  if (!src && !videoSrc) return;
  const name = file.converted ? file.convertedName : file.name;
  const media =
    file.kind === "video"
      ? `<div class="avi-preview-modal">${renderAviThumb(file)}<video class="preview-video" src="${videoSrc}" controls></video><p>如浏览器无法直接播放 AVI，请下载原文件后使用本地播放器打开。</p></div>`
      : `<img src="${src}" alt="${name}" />`;
  openModal(
    file.kind === "video" ? "AVI 动态视频预览" : "JPG 图像预览",
    `
      <div class="preview-modal">
        ${media}
        <div class="modal-actions">
          <button class="ghost modal-cancel" type="button">关闭</button>
          <button class="primary download-file inline" data-download-id="${file.id}" type="button">${file.converted ? "下载JPG" : file.kind === "video" ? "下载原文件" : "下载原图"}</button>
        </div>
      </div>
    `,
  );
  if (objectUrl) window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
}

async function downloadUploadPreview(uploadId) {
  const file = findUpload(uploadId);
  if (!file) return;
  if (file.kind === "video" || file.kind === "file") {
    if (file.remoteUrl) {
      await downloadUrl(file.remoteUrl, file.name || "附件");
      toast(`${file.name || "文件"} 已开始下载`);
      return;
    }
    try {
      const record = await getUploadBlob(file.blobId);
      if (!record?.blob) {
        toast("未找到原始文件，请在上传该文件的浏览器中下载或重新上传");
        return;
      }
      const objectUrl = URL.createObjectURL(record.blob);
      await downloadUrl(objectUrl, file.name || record.name || "附件");
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1200);
      toast(`${file.name || "文件"} 已开始下载`);
      return;
    } catch (error) {
      toast(`文件读取失败：${error.message}`);
      return;
    }
  }
  const src = file.converted ? file.convertedSrc : file.kind === "video" ? file.videoSrc : file.src;
  if (!src) return;
  const name = file.converted ? file.convertedName : file.name;
  await downloadUrl(src, name || "converted-preview.jpg");
  toast(`${name || "文件"} 已开始下载`);
}

function renderReportFiles() {
  const reportCategories = ["lab", "pathology", "ct", "followup", "other"];
  reportCategories.forEach((category) => {
    const container = reportFileContainers[category];
    if (!container) return;
    const files = selectedCase.uploads.filter((file) => file.category === category);
    container.innerHTML = files.length ? files.map(renderUploadRow).join("") : '<div class="empty-state small">暂无报告文件</div>';
  });
  if (reportAllFiles) {
    const files = selectedCase.uploads;
    reportAllFiles.innerHTML = files.length ? files.map(renderUploadRow).join("") : '<div class="empty-state">当前病例暂无上传资料。</div>';
  }
  if (reportTotalCount) reportTotalCount.textContent = `${selectedCase.uploads.length} 份`;
  if (reportPatientSummary) reportPatientSummary.textContent = `${selectedCase.name}（${selectedCase.id}）共上传 ${selectedCase.uploads.length} 份资料，当前状态：${selectedCase.status}`;
}

function renderReportMatrix() {
  const labels = { history: "病史", lab: "检验结果", pathology: "病理报告", ct: "CT / MRI / 核医学", followup: "随访结果", other: "其他" };
  Object.keys(labels).forEach((category) => {
    const files = selectedCase.uploads.filter((file) => file.category === category);
    const count = document.querySelector(`#${category}Count`);
    const status = document.querySelector(`#${category}Status`);
    const latest = document.querySelector(`#${category}Latest`);
    if (count) count.textContent = `${files.length} 份`;
    if (status) {
      const allStored = files.length > 0 && files.every((file) => file.reviewStatus === "已入库");
      status.textContent = files.length ? (allStored ? "已入库" : "待审核") : "待补充";
      status.className = files.length ? (allStored ? "ok" : "warn") : "warn";
    }
    if (latest) latest.textContent = files[0]?.uploadedAt || "-";
  });
  const ultrasoundFiles = selectedCase.uploads.filter((file) => getImageCategories().includes(file.category));
  const ultrasoundCount = document.querySelector("#ultrasoundCount");
  const ultrasoundStatus = document.querySelector("#ultrasoundStatus");
  const ultrasoundLatest = document.querySelector("#ultrasoundLatest");
  if (ultrasoundCount) ultrasoundCount.textContent = `${ultrasoundFiles.length} 份`;
  if (ultrasoundStatus) {
    const allStored = ultrasoundFiles.length > 0 && ultrasoundFiles.every((file) => file.reviewStatus === "已入库");
    ultrasoundStatus.textContent = ultrasoundFiles.length ? (allStored ? "已入库" : "待审核") : "待补充";
    ultrasoundStatus.className = ultrasoundFiles.length ? (allStored ? "ok" : "warn") : "warn";
  }
  if (ultrasoundLatest) ultrasoundLatest.textContent = ultrasoundFiles[0]?.uploadedAt || "-";
}

function renderImageQualitySummary() {
  const categories = [
    ["gray", imageQcNodes.grayCount, imageQcNodes.grayStatus],
    ["color", imageQcNodes.colorCount, imageQcNodes.colorStatus],
    ["spectrum", imageQcNodes.spectrumCount, imageQcNodes.spectrumStatus],
    ["threeD", imageQcNodes.threeDCount, imageQcNodes.threeDStatus],
    ["contrast", imageQcNodes.contrastCount, imageQcNodes.contrastStatus],
    ["elastography", imageQcNodes.elastographyCount, imageQcNodes.elastographyStatus],
  ];
  const imageFiles = selectedCase.uploads.filter((file) => getImageCategories().includes(file.category));
  categories.forEach(([category, countNode, statusNode]) => {
    const files = selectedCase.uploads.filter((file) => file.category === category);
    if (countNode) countNode.textContent = `${files.length} 份`;
    if (statusNode) {
      const allStored = files.length && files.every((file) => file.reviewStatus === "已入库");
      statusNode.textContent = files.length ? (allStored ? "已入库" : "待审核") : "待补充";
      statusNode.className = files.length ? (allStored ? "ok" : "warn") : "warn";
    }
  });
  if (imageQcNodes.total) imageQcNodes.total.textContent = `${imageFiles.length} 份`;
  if (imageQcNodes.pending) imageQcNodes.pending.textContent = `${imageFiles.filter((file) => file.reviewStatus !== "已入库").length} 份`;
  if (imageQcNodes.dicom) imageQcNodes.dicom.textContent = `${imageFiles.filter((file) => file.converted).length} 份`;
}

function exportPatientReport() {
  if (!requirePermission("export", "当前角色不能导出病例报告")) return;
  const labels = { history: "病史", gray: "灰阶超声", color: "彩色多普勒超声", spectrum: "频谱多普勒超声", threeD: "三维超声", contrast: "超声造影", elastography: "弹性成像", lab: "检验结果", pathology: "病理报告", ct: "CT / MRI / 核医学", followup: "随访结果", other: "其他" };
  const categoryRows = Object.entries(labels)
    .map(([category, label]) => {
      const files = selectedCase.uploads.filter((file) => file.category === category);
      if (!files.length) return "";
      const stored = files.filter((file) => file.reviewStatus === "已入库").length;
      return `<tr><td>${label}</td><td>${files.length} 份</td><td>${stored} 份</td><td>${escapeWord(files[0]?.uploadedAt || "-")}</td></tr>`;
    })
    .join("");
  const detailRows = selectedCase.uploads.length
    ? selectedCase.uploads
        .map(
          (file, index) =>
            `<tr><td>${index + 1}</td><td>${escapeWord(labels[file.category] || file.label || file.category)}</td><td>${escapeWord(file.convertedName || file.name)}</td><td>${escapeWord(file.name)}</td><td>${escapeWord(file.reviewStatus || (file.stored ? "已入库" : "待初审"))}</td><td>${escapeWord(file.uploadedAt || "-")}</td><td>${escapeWord(file.converted ? file.dicomMeta || "已转换为JPG预览" : "-")}</td></tr>`,
        )
        .join("")
    : '<tr><td colspan="7">暂无上传资料。</td></tr>';
  downloadWordFile(
    `${selectedCase.id}_资料报告.doc`,
    `
      <h1>卵巢肿瘤影像数据收集平台 - 病例资料报告</h1>
      <p class="muted">导出时间：${new Date().toLocaleString("zh-CN")}</p>
      <h2>一、病例基本信息</h2>
      <table>
        <tbody>
          <tr><th>病例编号</th><td>${escapeWord(selectedCase.id)}</td><th>病例标识</th><td>${escapeWord(selectedCase.name)}</td></tr>
          <tr><th>年龄</th><td>${selectedCase.age}</td><th>上传机构</th><td>${escapeWord(selectedCase.org)}</td></tr>
          <tr><th>检查部位</th><td>${escapeWord(selectedCase.part)}</td><th>当前状态</th><td>${escapeWord(selectedCase.status)}</td></tr>
          <tr><th>资料完整度</th><td>${selectedCase.progress}%</td><th>上传总数</th><td>${selectedCase.uploads.length} 份</td></tr>
          <tr><th>诊断/病理结果</th><td colspan="3">${escapeWord(selectedCase.diagnosis)}</td></tr>
        </tbody>
      </table>
      <h2>二、资料上传概况</h2>
      <table>
        <thead><tr><th>资料类型</th><th>文件数</th><th>已入库</th><th>最近上传</th></tr></thead>
        <tbody>${categoryRows || '<tr><td colspan="4">暂无上传资料。</td></tr>'}</tbody>
      </table>
      <h2>三、资料明细</h2>
      <table>
        <thead><tr><th>序号</th><th>类型</th><th>文件名</th><th>原始文件</th><th>审核状态</th><th>上传时间</th><th>DICOM转换</th></tr></thead>
        <tbody>${detailRows}</tbody>
      </table>
      <h2>四、简要结论</h2>
      <p>${selectedCase.uploads.length ? "该病例已有上传资料，可结合病例查看和影像质控模块继续审核、预览或入库。" : "该病例尚无上传资料，请在病例查看模块补充。"}</p>
    `,
  );
  toast(`${selectedCase.id} 的 Word 报告已导出`);
}

function openCaseUpload() {
  showPanel("casePanel");
  setCaseTab("ultrasound");
  setScan(activeScan);
  toast("已进入病例查看 - 超声图像上传");
}

function deleteUpload(uploadId) {
  if (!canDeleteUpload(uploadId)) {
    toast("普通用户只能删除本人上传的文件");
    return;
  }
  selectedCase.uploads = selectedCase.uploads.filter((file) => file.id !== uploadId);
  selectedUploadIds.delete(uploadId);
  selectedCase.progress = Math.max(0, selectedCase.progress - 5);
  saveDatabase();
  updateDetail(selectedCase);
  renderRows();
  toast("文件已删除");
}

function toggleOrganizationShare() {
  if (!isAdminProfile()) {
    toast("仅主体管理员或平台管理员可以调整本院授权范围");
    return;
  }
  selectedCase.shareWithOrganization = !selectedCase.shareWithOrganization;
  saveDatabase();
  addUserHistory("病例授权", `${selectedCase.id} ${selectedCase.shareWithOrganization ? "授权本院普通用户可见" : "取消本院共享"}`);
  applyRolePermissions();
  toast(selectedCase.shareWithOrganization ? "已授权本院普通用户查看" : "已取消本院共享");
}

function storeCurrentCase() {
  if (!requirePermission("finalize", "仅主体管理员或平台管理员可以最终入库")) return;
  const fileMode = selectedUploadIds.size > 0;
  const files = selectedUploadIds.size
    ? selectedCase.uploads.filter((file) => selectedUploadIds.has(file.id))
    : selectedCase.uploads;
  files.forEach((file) => {
    file.stored = true;
    file.reviewStatus = "已入库";
  });
  if (!fileMode) {
    selectedCase.status = "已入库";
    selectedCase.progress = 100;
    activeStatus = "已入库";
    statusCards.forEach((card) => card.classList.toggle("active", card.dataset.status === activeStatus));
  }
  selectedUploadIds.clear();
  saveDatabase();
  addUserHistory("审批入库", fileMode ? `${selectedCase.id} 选中文件已入库` : `${selectedCase.id} 病例已入库`);
  updateDetail(selectedCase);
  renderRows();
  toast(fileMode ? "选中文件已入库" : `${selectedCase.id} 已入库保留`);
}

function updateSelectedCount() {
  if (selectedCount) selectedCount.textContent = `已选 ${selectedIds.size} 条`;
  if (selectAllCases) {
    const checks = [...document.querySelectorAll(".case-check")];
    selectAllCases.checked = checks.length > 0 && checks.every((input) => input.checked);
  }
}

document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", () => showPanel(item.dataset.panel));
});

document.querySelectorAll(".flow-guide button").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.panel) showPanel(button.dataset.panel);
    if (button.dataset.tabJump) setCaseTab(button.dataset.tabJump);
    if (button.dataset.action === "export-ledger") exportLedger();
  });
});

document.querySelectorAll(".site-nav button, .hero-actions button, .quick-grid button, .home-task-grid article").forEach((button) => {
  button.addEventListener("click", (event) => {
    const target = event.target.closest("button, article");
    if (target.dataset.panel) showPanel(target.dataset.panel);
    if (target.dataset.tabJump) setCaseTab(target.dataset.tabJump);
    if (target.dataset.action === "messages") openMessagesModal();
  });
});

document.querySelectorAll(".auth-switch button").forEach((button) => {
  button.addEventListener("click", () => {
    const view = button.dataset.authView;
    document.querySelectorAll(".auth-switch button").forEach((item) => item.classList.toggle("active", item === button));
    document.querySelectorAll(".auth-form").forEach((form) => form.classList.toggle("active", form.id.toLowerCase().includes(view)));
  });
});

if (authLoginForm) {
  authLoginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(authLoginForm);
    const username = String(formData.get("username") || "").trim();
    const password = String(formData.get("password") || "");
    const savedUser = findUser(username) || loadUserProfile();
    const isAdmin = username === "管理员";
    const knownUser = isAdmin || username === savedUser.username || username === savedUser.contact;
    const expectedPassword = isAdmin ? "12345678" : savedUser.password;
    if (!knownUser || password !== expectedPassword) {
      toast("账号或密码错误，请检查用户名和密码");
      return;
    }
    setCurrentUser(isAdmin ? defaultUserProfile : savedUser);
    saveUserProfile();
    addUserHistory("登录", `${username} 登录工作台`);
    setAuthenticated(true);
    toast("登录成功，已进入工作台");
  });
}

if (authRegisterForm) {
  authRegisterForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(authRegisterForm);
    const phone = String(data.get("phone") || "").trim();
    const smsCode = String(data.get("smsCode") || "").trim();
    if (!isValidPhone(phone)) {
      toast("请输入有效的 11 位手机号");
      return;
    }
    if (!pendingSmsCode || smsCode !== pendingSmsCode) {
      toast("验证码不正确，请先获取并输入 6 位验证码");
      return;
    }
    const avatarFile = data.get("avatar");
    const avatar = avatarFile && avatarFile.size ? await fileToDataUrl(avatarFile) : "";
    const roleType = String(data.get("role") || "uploader");
    const employeeId = String(data.get("employeeId") || "").trim().toUpperCase();
    const requestedOrganization = String(data.get("organization") || "");
    if (["organization_admin", "platform_admin"].includes(roleType) && !validateAdminEmployeeId(employeeId)) {
      toast("管理员注册失败：员工编号核验未通过");
      return;
    }
    if (roleType === "platform_admin" && requestedOrganization !== "总PI单位") {
      toast("平台管理员仅能注册在总PI单位");
      return;
    }
    const registered = upsertUser({
      username: data.get("username"),
      contact: data.get("contact"),
      phone,
      organization: roleType === "platform_admin" ? "总PI单位" : requestedOrganization,
      department: data.get("department"),
      title: data.get("title"),
      password: data.get("password"),
      avatar,
      role: roleLabel({ roleType }),
      roleType,
      employeeId,
    });
    setCurrentUser(registered);
    saveUserProfile();
    addUserHistory("注册", `${currentUserProfile.contact} 完成${roleLabel({ roleType })}账号注册`);
    setAuthenticated(true);
    toast("注册成功，已进入工作台");
  });
}

if (sendSmsCodeButton) {
  sendSmsCodeButton.addEventListener("click", () => {
    const phoneInput = authRegisterForm?.querySelector('[name="phone"]');
    const phone = phoneInput?.value.trim();
    if (!isValidPhone(phone)) {
      toast("请先输入有效手机号");
      return;
    }
    pendingSmsCode = String(Math.floor(100000 + Math.random() * 900000));
    const codeInput = authRegisterForm.querySelector('[name="smsCode"]');
    if (codeInput) codeInput.value = pendingSmsCode;
    sendSmsCodeButton.textContent = "已发送";
    toast(`演示验证码：${pendingSmsCode}`);
  });
}

if (tciaLogoutButton) {
  tciaLogoutButton.addEventListener("click", () => {
    addUserHistory("退出", `${currentUserProfile.contact || currentUserProfile.username} 退出工作台`);
    setAuthenticated(false);
    toast("已退出登录");
  });
}

[tciaProfileTrigger, tciaUserTextButton].forEach((button) => {
  if (!button) return;
  button.addEventListener("click", openProfileModal);
});

if (adminCreateUserForm) {
  adminCreateUserForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!isAdminProfile()) {
      toast("当前账号无管理员权限");
      return;
    }
    const data = new FormData(adminCreateUserForm);
    const roleType = String(data.get("role") || "uploader");
    const employeeId = String(data.get("employeeId") || "").trim().toUpperCase();
    if (!isPlatformAdmin() && !["uploader", "quality_reviewer"].includes(roleType)) {
      toast("主体管理员只能创建普通用户或质控员");
      return;
    }
    if (["organization_admin", "platform_admin"].includes(roleType) && !validateAdminEmployeeId(employeeId)) {
      toast("管理员注册失败：员工编号核验未通过");
      return;
    }
    const organization = isPlatformAdmin()
      ? String(adminCreateUserForm.querySelector('[name="organization"]')?.value || "总PI单位")
      : currentUserProfile.organization;
    if (roleType === "platform_admin" && organization !== "总PI单位") {
      toast("平台管理员仅能创建在总PI单位");
      return;
    }
    const user = upsertUser({
      username: data.get("username"),
      contact: data.get("contact"),
      phone: data.get("phone"),
      organization: roleType === "platform_admin" ? "总PI单位" : organization,
      department: currentUserProfile.department || "超声科",
      title: "待完善",
      password: data.get("password"),
      role: roleLabel({ roleType }),
      roleType,
      employeeId,
      avatar: "",
    });
    addUserHistory("管理员注册用户", `${currentUserProfile.contact} 注册 ${user.contact}（${roleLabel({ roleType })}）`);
    adminCreateUserForm.reset();
    adminCreateUserForm.querySelector('[name="password"]').value = "12345678";
    renderAdminDashboard();
    toast("用户已注册");
  });
}

if (adminUserTable) {
  adminUserTable.addEventListener("click", (event) => {
    const row = event.target.closest(".admin-user-row");
    if (!row) return;
    selectedAdminUsername = row.dataset.username || "";
    renderAdminDashboard();
  });
  adminUserTable.addEventListener("keydown", (event) => {
    if (!["Enter", " "].includes(event.key)) return;
    const row = event.target.closest(".admin-user-row");
    if (!row) return;
    event.preventDefault();
    selectedAdminUsername = row.dataset.username || "";
    renderAdminDashboard();
  });
}

adminUserSearchField?.addEventListener("change", renderAdminDashboard);
adminUserSearchInput?.addEventListener("input", renderAdminDashboard);
adminUserSelector?.addEventListener("change", () => {
  selectedAdminUsername = adminUserSelector.value;
  renderAdminDashboard();
});
adminSelectedActionButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const user = selectedAdminUser();
    if (!user) {
      toast("请先搜索并选择用户");
      return;
    }
    const action = button.dataset.adminSelectedAction;
    if (action === "message") openAdminMessageForm(user);
    if (action === "role") openAdminRoleForm(user);
    if (action === "kick") {
      if (normalizeRoleType(user) === "platform_admin") {
        toast("不能踢出平台管理员账号");
        return;
      }
      openAdminActionConfirmation({ type: "kick", username: user.username });
    }
  });
});

imageGrid.addEventListener("click", async (event) => {
  const preview = event.target.closest("[data-preview-id]");
  if (preview) {
    openPreview(preview.dataset.previewId);
    return;
  }
  const download = event.target.closest("[data-download-id]");
  if (download) {
    await downloadUploadPreview(download.dataset.downloadId);
    return;
  }
  const check = event.target.closest(".upload-check");
  if (check) {
    if (check.checked) selectedUploadIds.add(check.dataset.uploadId);
    else selectedUploadIds.delete(check.dataset.uploadId);
    renderUploadViews();
    return;
  }
  const button = event.target.closest(".delete-file");
  if (!button) return;
  deleteUpload(button.dataset.uploadId);
});

if (uploadList) {
  uploadList.addEventListener("click", async (event) => {
    const preview = event.target.closest("[data-preview-id]");
    if (preview) {
      openPreview(preview.dataset.previewId);
      return;
    }
    const download = event.target.closest("[data-download-id]");
    if (download) {
      await downloadUploadPreview(download.dataset.downloadId);
      return;
    }
    const check = event.target.closest(".upload-check");
    if (check) {
      if (check.checked) selectedUploadIds.add(check.dataset.uploadId);
      else selectedUploadIds.delete(check.dataset.uploadId);
      renderUploadViews();
      return;
    }
    const button = event.target.closest(".delete-file");
    if (!button) return;
    deleteUpload(button.dataset.uploadId);
  });
}

document.querySelectorAll(".report-files, #reportAllFiles").forEach((container) => {
  container.addEventListener("click", async (event) => {
    const preview = event.target.closest("[data-preview-id]");
    if (preview) {
      openPreview(preview.dataset.previewId);
      return;
    }
    const download = event.target.closest("[data-download-id]");
    if (download) {
      await downloadUploadPreview(download.dataset.downloadId);
      return;
    }
    const check = event.target.closest(".upload-check");
    if (check) {
      if (check.checked) selectedUploadIds.add(check.dataset.uploadId);
      else selectedUploadIds.delete(check.dataset.uploadId);
      renderUploadViews();
      return;
    }
    const button = event.target.closest(".delete-file");
    if (!button) return;
    deleteUpload(button.dataset.uploadId);
  });
});

statusCards.forEach((card) => {
  card.addEventListener("click", () => {
    activeStatus = card.dataset.status;
    statusCards.forEach((item) => item.classList.remove("active"));
    card.classList.add("active");
    selectedIds.clear();
    renderRows();
  });
});

if (queryButton) {
  queryButton.addEventListener("click", () => {
    activeQuery = keywordInput?.value.trim() || "";
    queryApplied = true;
    selectedIds.clear();
    renderRows();
    toast("查询已完成，命中内容已在列表中标出");
  });
}

if (resetButton) {
  resetButton.addEventListener("click", () => {
    if (partFilter) partFilter.value = "全部";
    if (orgFilter) orgFilter.value = isPlatformAdmin() ? "全部" : currentUserProfile.organization;
    if (hiddenFilter) hiddenFilter.value = "全部";
    if (keywordInput) keywordInput.value = "";
    activeQuery = "";
    queryApplied = false;
    selectedIds.clear();
    renderRows();
    toast("筛选条件已重置");
  });
}

if (caseSelector) {
  caseSelector.addEventListener("change", () => selectCaseById(caseSelector.value));
}

if (uploadCaseSelector) {
  uploadCaseSelector.addEventListener("change", () => selectCaseById(uploadCaseSelector.value, { panel: "uploadPanel" }));
}

if (reportCaseSelector) {
  reportCaseSelector.addEventListener("change", () => selectCaseById(reportCaseSelector.value, { panel: "reportPanel" }));
}

if (keywordInput) {
  keywordInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    queryButton?.click();
  });
}

rows.addEventListener("click", (event) => {
  const check = event.target.closest(".case-check");
  if (check) {
    if (check.checked) selectedIds.add(check.dataset.id);
    else selectedIds.delete(check.dataset.id);
    updateSelectedCount();
    return;
  }
  const target = event.target.closest("[data-id]");
  if (!target) return;
  const found = getVisibleCases().find((item) => item.id === target.dataset.id);
  if (!found) return;
  updateDetail(found);
  renderRows();
  showPanel("casePanel");
});

if (selectAllCases) {
  selectAllCases.addEventListener("change", () => {
    document.querySelectorAll(".case-check").forEach((input) => {
      input.checked = selectAllCases.checked;
      if (input.checked) selectedIds.add(input.dataset.id);
      else selectedIds.delete(input.dataset.id);
    });
    updateSelectedCount();
  });
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => setCaseTab(tab.dataset.tab));
});

document.querySelectorAll(".mini-tab").forEach((tab) => {
  tab.addEventListener("click", () => setScan(tab.dataset.scan));
});

document.querySelectorAll(".upload-button").forEach((button) => {
  button.addEventListener("click", () => {
    startUpload({
      target: button.dataset.upload || button.textContent.trim(),
      category: button.dataset.scan || button.dataset.category || "other",
      scan: button.dataset.scan || "",
    });
  });
});

document.querySelector("#pickFiles").addEventListener("click", () => {
  startUpload({ target: scanTypes[activeScan].title, category: activeScan, scan: activeScan });
});

fileInput.addEventListener("change", () => addFiles(fileInput.files));

["dragenter", "dragover"].forEach((type) => {
  uploadZone.addEventListener(type, (event) => {
    event.preventDefault();
    uploadZone.classList.add("dragging");
  });
});

["dragleave", "drop"].forEach((type) => {
  uploadZone.addEventListener(type, (event) => {
    event.preventDefault();
    uploadZone.classList.remove("dragging");
  });
});

uploadZone.addEventListener("drop", (event) => {
  if (!canUploadToSelectedCase()) {
    if (hasPermission("upload")) {
      openNewCaseModal();
      toast("请先建立本院病例，保存后再拖拽上传");
    } else {
      toast("当前账号没有上传权限");
    }
    return;
  }
  uploadTarget = scanTypes[activeScan].title;
  uploadCategory = activeScan;
  addFiles(event.dataTransfer.files);
});

document.querySelectorAll(".top-actions button").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.action === "new-case") openNewCaseModal();
    if (button.dataset.action === "messages") openMessagesModal();
    if (button.dataset.action === "export") exportCases();
    if (button.dataset.action === "logout") {
      setAuthenticated(false);
      toast("已退出登录");
    }
  });
});

document.querySelectorAll(".panel-head button, .review-bar button").forEach((button) => {
  button.addEventListener("click", async () => {
    const action = button.dataset.action;
    if (action === "new-case") openNewCaseModal();
    else if (action === "download-template") downloadTemplate();
    else if (action === "download-report-template") downloadReportTemplate();
    else if (action === "export-ledger") exportLedger();
    else if (action === "export-patient-report") exportPatientReport();
    else if (action === "open-case-upload") openCaseUpload();
    else if (action === "batch-export") exportSelectedCases();
    else if (action === "batch-store") batchStore();
    else if (action === "store-current") storeCurrentCase();
    else if (action === "toggle-organization-share") toggleOrganizationShare();
    else if (action === "role-upload") startRoleUpload(button);
    else if (action === "preview-latest") previewLatestUpload(button.closest("[data-workflow-stage]")?.dataset.workflowStage);
    else if (action === "download-current-files") await downloadCurrentCaseFiles();
    else if (button.dataset.review) reviewCurrentCase(button.dataset.review);
    else if (button.textContent.includes("导出")) exportCases();
    else toast(`${button.textContent.trim()} 已响应`);
  });
});

document.querySelectorAll("[data-save-section]").forEach((button) => {
  button.addEventListener("click", () => saveCaseSection(button.dataset.saveSection));
});

modalBackdrop.addEventListener("click", async (event) => {
  const download = event.target.closest("[data-download-id]");
  if (download) {
    await downloadUploadPreview(download.dataset.downloadId);
    return;
  }
  if (event.target === modalBackdrop || event.target.closest(".modal-close") || event.target.closest(".modal-cancel")) closeModal();
});

modalBackdrop.addEventListener("submit", async (event) => {
  const reviewFeedbackForm = event.target.closest("#reviewFeedbackForm");
  if (reviewFeedbackForm) {
    event.preventDefault();
    const data = new FormData(reviewFeedbackForm);
    const reason = String(data.get("reason") || "").trim();
    if (!reason) {
      toast("请填写问题说明");
      return;
    }
    const status = reviewFeedbackForm.dataset.reviewStatus;
    closeModal();
    reviewCurrentCase(status, reason);
    return;
  }
  const adminRoleForm = event.target.closest("#adminRoleForm");
  if (adminRoleForm) {
    event.preventDefault();
    if (!isAdminProfile()) {
      toast("当前账号无用户管理权限");
      return;
    }
    const user = findUser(adminRoleForm.dataset.username);
    const data = new FormData(adminRoleForm);
    const roleType = String(data.get("role") || "uploader");
    let organization = String(data.get("organization") || currentUserProfile.organization);
    if (!user) {
      toast("未找到该用户");
      return;
    }
    if (!isPlatformAdmin() && !["uploader", "quality_reviewer"].includes(roleType)) {
      toast("主体管理员只能分配普通用户或质控员");
      return;
    }
    if (["organization_admin", "platform_admin"].includes(roleType) && !validateAdminEmployeeId(data.get("employeeId"))) {
      toast("管理员角色调整失败：员工编号核验未通过");
      return;
    }
    if (!isPlatformAdmin()) organization = currentUserProfile.organization;
    if (roleType === "platform_admin") organization = "总PI单位";
    openAdminActionConfirmation({
      type: "role",
      username: user.username,
      roleType,
      organization,
      employeeId: String(data.get("employeeId") || user.employeeId || "").trim(),
    });
    return;
  }
  const adminMessageForm = event.target.closest("#adminMessageForm");
  if (adminMessageForm) {
    event.preventDefault();
    const user = findUser(adminMessageForm.dataset.username);
    const data = new FormData(adminMessageForm);
    if (!user) {
      toast("未找到接收人");
      return;
    }
    openAdminActionConfirmation({
      type: "message",
      username: user.username,
      title: String(data.get("title") || "").trim(),
      message: String(data.get("message") || "").trim(),
    });
    return;
  }
  const adminConfirmForm = event.target.closest("#adminConfirmForm");
  if (adminConfirmForm) {
    event.preventDefault();
    const action = pendingAdminAction;
    const user = action ? findUser(action.username) : null;
    if (!action || !user) {
      toast("操作对象已不存在，请重新选择");
      closeModal();
      renderAdminDashboard();
      return;
    }
    if (action.type === "message") {
      addUserHistory("发送信息", `${currentUserProfile.contact} 向 ${user.contact || user.username} 发送：${action.title} - ${action.message}`);
      closeModal();
      renderAdminDashboard();
      toast("信息已发送");
      return;
    }
    if (action.type === "role") {
      upsertUser({
        ...user,
        roleType: action.roleType,
        role: roleLabel({ roleType: action.roleType }),
        organization: action.organization,
        employeeId: action.employeeId || user.employeeId,
      });
      addUserHistory("调整角色", `${user.contact || user.username} 调整为${roleLabel({ roleType: action.roleType })}（${action.organization}）`);
      closeModal();
      renderAdminDashboard();
      toast("用户角色已更新");
      return;
    }
    if (action.type === "kick") {
      if (normalizeRoleType(user) === "platform_admin") {
        toast("不能踢出平台管理员账号");
        return;
      }
      deleteUser(user.username);
      addUserHistory("踢出用户", `${currentUserProfile.contact} 踢出 ${user.contact || user.username}`);
      selectedAdminUsername = "";
      closeModal();
      renderAdminDashboard();
      toast("用户已踢出");
    }
    return;
  }
  const profileForm = event.target.closest("#profileForm");
  if (profileForm) {
    event.preventDefault();
    const data = new FormData(profileForm);
    const phone = String(data.get("phone") || "").trim();
    if (!isValidPhone(phone)) {
      toast("请输入有效手机号");
      return;
    }
    const avatarFile = data.get("avatar");
    const avatar = avatarFile && avatarFile.size ? await fileToDataUrl(avatarFile) : currentUserProfile.avatar;
    setCurrentUser({
      username: data.get("username"),
      contact: data.get("contact"),
      phone,
      organization: data.get("organization"),
      department: data.get("department"),
      title: data.get("title"),
      avatar,
    });
    upsertUser(currentUserProfile);
    saveUserProfile();
    addUserHistory("资料更新", "编辑个人基本信息");
    closeModal();
    toast("个人资料已保存");
    return;
  }
  const form = event.target.closest("#newCaseForm");
  if (!form) return;
  event.preventDefault();
  if (!requirePermission("create_case", "当前角色不能新建病例")) return;
  const data = new FormData(form);
  caseCounter += 1;
  const item = {
    id: `CASE-2026-${String(caseCounter).padStart(3, "0")}`,
    name: `病例${caseCounter}`,
    age: Number(data.get("age")),
    org: currentUserProfile.organization,
    part: data.get("part"),
    status: "待初审",
    progress: 20,
    diagnosis: data.get("diagnosis"),
    hidden: false,
    uploads: [],
    createdBy: currentUserProfile.username || currentUserProfile.contact,
    shareWithOrganization: false,
    examDate: data.get("examDate"),
    equipment: data.get("equipment"),
    reproductiveHistory: data.get("reproductiveHistory"),
    familyHistory: data.get("familyHistory"),
    treatmentHistory: data.get("treatmentHistory"),
  };
  cases.unshift(item);
  selectedCase = item;
  activeStatus = "待初审";
  statusCards.forEach((card) => card.classList.toggle("active", card.dataset.status === activeStatus));
  saveDatabase();
  addUserHistory("新建病例", `${item.id} · ${item.org}`);
  renderRows();
  updateDetail(item);
  closeModal();
  toast("新病例已创建");
  if (pendingUploadRequest) {
    const request = pendingUploadRequest;
    pendingUploadRequest = null;
    startUpload(request);
  }
});

function exportSelectedCases() {
  if (!requirePermission("export", "当前角色不能导出病例数据")) return;
  const list = getVisibleCases().filter((item) => selectedIds.has(item.id));
  if (!list.length) {
    toast("请先选择需要导出的病例");
    return;
  }
  const header = ["编号", "病例", "年龄", "机构", "检查部位", "状态", "完整度", "上传文件数"];
  const lines = list.map((item) => [item.id, item.name, item.age, item.org, item.part, item.status, `${item.progress}%`, item.uploads.length].join(","));
  downloadTextFile("卵巢平台选中病例.csv", [header.join(","), ...lines].join("\n"));
  toast(`已导出 ${list.length} 条选中病例`);
}

function batchStore() {
  if (!requirePermission("finalize", "仅主体管理员或平台管理员可以批量入库")) return;
  const list = getVisibleCases().filter((item) => selectedIds.has(item.id));
  if (!list.length) {
    toast("请先选择需要入库的数据");
    return;
  }
  list.forEach((item) => {
    item.status = "已入库";
    item.progress = 100;
    item.uploads.forEach((file) => {
      file.stored = true;
      file.reviewStatus = "已入库";
    });
  });
  saveDatabase();
  addUserHistory("批量入库", `${list.length} 条本权限范围病例已入库`);
  activeStatus = "已入库";
  statusCards.forEach((card) => card.classList.toggle("active", card.dataset.status === activeStatus));
  selectedIds.clear();
  renderRows();
  if (list.some((item) => item.id === selectedCase.id)) updateDetail(selectedCase);
  toast(`已入库 ${list.length} 条数据`);
}

function openReviewFeedbackModal(status) {
  const selectedFiles = selectedCase.uploads.filter((file) => selectedUploadIds.has(file.id));
  const recipients = [...new Set(selectedFiles.map((file) => file.uploadedBy).filter(Boolean))];
  openModal(
    status === "退审中" ? "填写退回原因" : status === "作废数据" ? "填写作废原因" : "标记资料问题",
    `
      <form class="modal-form" id="reviewFeedbackForm" data-review-status="${escapeHtml(status)}">
        <p class="modal-help">已选择 ${selectedFiles.length} 个文件。确认后，问题说明将记录到文件，并发送给上传用户：${escapeHtml(recipients.join("、") || "未知用户")}。</p>
        <label class="full">问题说明<textarea name="reason" required maxlength="500" placeholder="请写明需要补充、修正或重新上传的内容"></textarea></label>
        <div class="modal-actions">
          <button class="ghost modal-cancel" type="button">取消</button>
          <button class="primary" type="submit">确定并发送</button>
        </div>
      </form>
    `,
  );
}

function reviewCurrentCase(status, reason = "") {
  if (!requirePermission("review", "当前角色没有初审或质控权限")) return;
  if (status === "已入库" && !requirePermission("finalize", "仅主体管理员或平台管理员可以最终入库")) return;
  if (!selectedUploadIds.size) {
    toast("请先勾选需要操作的文件");
    return;
  }
  if (["退审中", "不认可数据", "作废数据"].includes(status) && !reason.trim()) {
    openReviewFeedbackModal(status);
    return;
  }
  const recipients = new Set();
  selectedCase.uploads.forEach((file) => {
    if (!selectedUploadIds.has(file.id)) return;
    file.reviewStatus = status;
    file.stored = status === "已入库";
    if (reason.trim()) {
      file.reviewNote = reason.trim();
      file.reviewedBy = currentUserProfile.username || currentUserProfile.contact;
      file.reviewedAt = new Date().toLocaleString("zh-CN");
      if (file.uploadedBy) recipients.add(file.uploadedBy);
    }
  });
  selectedCase.status = status;
  activeStatus = status;
  statusCards.forEach((card) => card.classList.toggle("active", card.dataset.status === activeStatus));
  selectedUploadIds.clear();
  saveDatabase();
  addUserHistory(
    reason.trim() ? "审核反馈" : "文件审核",
    reason.trim()
      ? `${selectedCase.id} ${status}：${reason.trim()}；已发送给 ${[...recipients].join("、") || "上传用户"}`
      : `${selectedCase.id} 选中文件更新为${status}`,
  );
  updateDetail(selectedCase);
  renderRows();
  toast(reason.trim() ? "问题说明已记录并发送给上传用户" : `选中文件已更新为：${status}`);
}

window.addEventListener("storage", (event) => {
  if (event.key === databaseKey) refreshSharedCaseData(event.newValue, true);
});

caseDataChannel?.addEventListener("message", (event) => {
  if (event.data?.type === "cases-updated") refreshSharedCaseData(localStorage.getItem(databaseKey), true);
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshSharedCaseData(localStorage.getItem(databaseKey), false);
});

window.setInterval(() => {
  if (authenticated) {
    refreshSharedCaseData(localStorage.getItem(databaseKey), false);
    syncCasesFromServer(false);
  }
}, 3000);

initializeOrganizationSelectors();
initializeAuthGate();
renderRows();
updateDetail(selectedCase);
setScan(activeScan);

// Bridge the TCIA-style masthead navigation to the original app navigation.
document.querySelectorAll('.tcia-nav [data-panel]').forEach((button) => {
  button.addEventListener('click', () => {
    const panel = button.dataset.panel;
    const tabJump = button.dataset.tabJump;
    const original = document.querySelector(`.site-nav [data-panel="${panel}"]${tabJump ? `[data-tab-jump="${tabJump}"]` : ''}`) ||
      document.querySelector(`.nav-list [data-panel="${panel}"]`);
    if (original) original.click();
    document.querySelectorAll('.tcia-nav [data-panel]').forEach((item) => item.classList.toggle('active', item === button));
  });
});

// Direct bridge for the TCIA-style masthead navigation.
document.querySelectorAll('.tcia-nav [data-panel]').forEach((button) => {
  button.addEventListener('click', (event) => {
    event.preventDefault();
    const panel = button.dataset.panel;
    if (typeof showPanel === 'function') showPanel(panel);
    if (button.dataset.tabJump && typeof setCaseTab === 'function') setCaseTab(button.dataset.tabJump);
    document.querySelectorAll('.tcia-nav [data-panel]').forEach((item) => item.classList.toggle('active', item === button));
  });
});
