// Health Profile lives as a standalone HTML page on the store volume
// (/health-profile.html) so Nikki can keep it up to date without a rebuild.
// We embed it in a full-height iframe here so it renders inside the app
// shell — the sidebar stays put instead of navigating away. The ?embed=1
// flag tells the page to hide its own back-link (the sidebar handles nav).
export function HealthProfile() {
  return (
    <div class="h-full w-full bg-[var(--color-bg)]">
      <iframe
        src="/health-profile.html?embed=1"
        title="Health Profile"
        class="block w-full h-full border-0"
      />
    </div>
  );
}
