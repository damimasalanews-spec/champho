/* Navigation is a hash change; the router owns everything after that. */
export function go(path) {
  const hash = `#/${String(path).replace(/^#?\/?/, '')}`;
  if (location.hash === hash) {
    document.dispatchEvent(new CustomEvent('route:refresh'));
  } else {
    location.hash = hash;
  }
}

export function currentRoute() {
  return location.hash.replace(/^#\/?/, '').split('/')[0] || 'home';
}
