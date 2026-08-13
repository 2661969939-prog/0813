const standaloneForm = document.querySelector(".login-form");
const standaloneOrganization = standaloneForm?.querySelector('[name="organization"]');

if (standaloneOrganization) {
  const organizations = [
    "总PI单位",
    ...Array.from({ length: 5 }, (_, index) => `共建PI单位 ${String(index + 1).padStart(2, "0")}`),
    ...Array.from({ length: 20 }, (_, index) => `分PI单位 ${String(index + 1).padStart(2, "0")}`),
  ];
  standaloneOrganization.innerHTML = organizations.map((item) => `<option>${item}</option>`).join("");
}

if (standaloneForm) {
  standaloneForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const isRegister = window.location.pathname.endsWith("register.html");
    const draft = {};
    new FormData(standaloneForm).forEach((value, key) => {
      if (typeof value === "string") draft[key] = value;
    });
    sessionStorage.setItem(isRegister ? "ovaryPlatformRegisterDraft" : "ovaryPlatformLoginDraft", JSON.stringify(draft));
    window.location.href = `./index.html#${isRegister ? "register" : "login"}`;
  });
}
