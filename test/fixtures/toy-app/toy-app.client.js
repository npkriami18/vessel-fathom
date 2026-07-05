if (globalThis.document) {
  document.querySelector("#checkout")?.addEventListener("click", () => {
    window.location.href = "/confirm";
  });

  document.querySelector("#broken-save")?.addEventListener("click", () => {
    // Intentionally broken: declared expectation but no observable effect.
  });
}
