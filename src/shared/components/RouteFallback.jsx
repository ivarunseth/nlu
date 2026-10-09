// Suspense fallback for the app's lazily-loaded routes. Both boundaries used
// to render null, so every route change — including switching model tabs —
// blanked the content area with no sign that anything was loading.
//
// A slim indeterminate bar rather than a centred spinner: route chunks usually
// resolve in a few hundred milliseconds, and a spinner that appears and
// disappears that fast reads as a flicker rather than as progress.
const RouteFallback = () => (
    <div className="route-progress" role="status" aria-label="Loading">
        <span className="route-progress-bar" />
    </div>
);

export default RouteFallback;
