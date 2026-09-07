// Routes where the tab bar should be hidden.
// Matched via pathname.includes(route) so substrings are sufficient.
// Trailing slashes on the Learn patterns keep their hub pages (e.g.
// `/Learn/modules/X/Y/practice`) visible while hiding the immersive
// flow that lives one level deeper (e.g. `/practice/<id>/pages/1`).
export const HIDDEN_TAB_BAR_ROUTES = [
  'PostDetails',
  'AccountSettings',
  'post-details',
  'community-matching',
  '/lessons/',
  '/practice/',
  '/tasks/',
  '/intro/',
];
