// Page transition: fade out smoothly before navigating to another
// page on this site, instead of an abrupt jump cut.

document.addEventListener("click", (e) => {
    const link = e.target.closest("a");
    if (!link) return;

    const href = link.getAttribute("href");
    if (!href) return;

    // Skip external links, anchors, mailto, and new-tab links
    if (
        href.startsWith("http") ||
        href.startsWith("#") ||
        href.startsWith("mailto:") ||
        link.target === "_blank"
    ) {
        return;
    }

    e.preventDefault();
    document.body.classList.add("page-exit");

    setTimeout(() => {
        window.location.href = href;
    }, 250);
});
