/* global document */
// Applies an explicit theme choice before first paint to avoid a flash.
// Loaded as a file (not inline) so the Content-Security-Policy can forbid inline scripts.
try {
  var theme = localStorage.getItem('a-ai-theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
} catch {
  // Storage can be unavailable (private mode); the system theme applies.
}
