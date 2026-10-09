import { Container } from "react-bootstrap";

// The frame every page shares: a full-bleed container and a context bar across
// the top. Model pages fill that bar with a breadcrumb and the section subnav;
// pages that have no bar (Home, Account settings) still need the height
// reserved so their content starts on the same line.
//
// That reservation used to be an aria-hidden spacer div copy-pasted into each
// such route — invisible, easy to forget, and silently wrong the moment the
// real bar's height changes. Passing the bar as a slot makes the alignment
// structural instead: one component decides the frame, whether or not anything
// fills it.
const PageShell = ({ contextBar = null, children }) => (
    <Container fluid>
        {contextBar ?? <div className="page-context-bar" aria-hidden="true" />}
        {children}
    </Container>
);

export default PageShell;
