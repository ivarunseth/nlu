import { useContext, useEffect, useState } from "react";
import { Col, Row, Spinner } from "react-bootstrap";
import { Bookmarks, Braces, ChevronDoubleLeft, ChevronDoubleRight, PencilSquare, Tag, Tags } from "react-bootstrap-icons";
import { useOutlet, useSearchParams } from "react-router-dom";
import { ModelContext } from "../../../../contexts/ModelContext";
import AnnotationBuild from "./AnnotationBuild";
import ClassificationBuild from "./ClassificationBuild";
import DatasetJson from "./DatasetJson";
import UnderstandingBuild from "./UnderstandingBuild";
import { buildTabFor, buildTabsFor } from "./buildTabs";

// Build is a sidebar of tabs beside the workspace for the active one. The
// tabs branch on the model type — classification models manage labels that
// own whole utterances, named entity recognition models annotate spans inside
// model-scoped utterances against an entity registry, and language
// understanding models split their registry into intents and entities — and
// every kind ends with JSON, the whole dataset as one editable document.
//
// The active tab lives in ?tab= so it deep-links and the back button walks
// out of it; the first tab is the default, so a bare /build (and every
// existing ?tab=intents / ?tab=entities link) still lands where it did.
// Drill-ins (?intent= / ?entity=) belong to a tab and are dropped on a switch.
// A classification label's utterances page is a nested route, so it renders
// in the workspace slot with the rail still beside it, like the other
// drill-ins.
//
// On md+ the rail collapses to an icon strip (labels become tooltips) and
// remembers that per browser; the phone strip has nothing to collapse.
const RAIL_COLLAPSED_KEY = "build-rail-collapsed";

const readCollapsed = () => {
    try {
        return localStorage.getItem(RAIL_COLLAPSED_KEY) === "1";
    } catch {
        return false;
    }
};

const ICONS = {
    labels: <Tag />,
    annotations: <PencilSquare />,
    intents: <Bookmarks />,
    entities: <Tags />,
    json: <Braces />
};

const Build = () => {
    const { model } = useContext(ModelContext);
    const [searchParams, setSearchParams] = useSearchParams();
    const outlet = useOutlet();
    const [collapsed, setCollapsed] = useState(readCollapsed);

    useEffect(() => {
        try {
            localStorage.setItem(RAIL_COLLAPSED_KEY, collapsed ? "1" : "0");
        } catch {
            // A blocked store only costs the preference surviving a reload.
        }
    }, [collapsed]);

    if (!model) {
        return (
            <div className="d-flex justify-content-center align-items-center" style={{ minHeight: "50vh" }}>
                <Spinner animation="border" size="lg" />
            </div>
        );
    }

    const tabs = buildTabsFor(model.kind);
    const tab = buildTabFor(model.kind, searchParams.get("tab")).key;

    let page;
    if (outlet) page = outlet;
    else if (tab === "json") page = <DatasetJson />;
    else if (model.kind === "named_entity_recognition") page = <AnnotationBuild />;
    else if (model.kind === "natural_language_understanding") page = <UnderstandingBuild tab={tab} />;
    else page = <ClassificationBuild />;

    return (
        <Row className="g-3 g-md-4 app-fill">
            <Col xs={12} md="auto" className={`build-rail${collapsed ? " build-rail-collapsed" : ""}`}>
                {/* Sticky so the tabs stay in reach while a long table scrolls;
                    below md the rail becomes a segmented strip above the page. */}
                <nav className="build-rail-sticky" aria-label="Build sections">
                    <div className="build-rail-nav">
                        {tabs.map((item) => (
                            <button
                                key={item.key}
                                type="button"
                                className="build-rail-item"
                                aria-current={item.key === tab ? "page" : undefined}
                                title={collapsed ? item.label : undefined}
                                onClick={() => setSearchParams({ tab: item.key })}
                            >
                                {ICONS[item.key]}
                                <span className="build-rail-label">{item.label}</span>
                            </button>
                        ))}
                    </div>
                </nav>
                {/* Pinned to the rail's foot: the bottom of the viewport while
                    the page is taller than it, the end of the page otherwise. */}
                <button
                    type="button"
                    className="build-rail-toggle"
                    aria-expanded={!collapsed}
                    aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                    title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                    onClick={() => setCollapsed((value) => !value)}
                >
                    {collapsed ? <ChevronDoubleRight /> : <ChevronDoubleLeft />}
                </button>
            </Col>
            <Col style={{ minWidth: 0 }}>
                {page}
            </Col>
        </Row>
    );
};

export default Build;
