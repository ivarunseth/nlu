// The Build sidebar's tabs per model kind, in display order; the first is
// the default for a bare /build. Kept free of JSX so Model.jsx can name the
// active tab in its breadcrumb without pulling the lazy Build chunk in.
export const BUILD_TABS = {
    text_classification: [
        { key: "labels", label: "Labels" },
        { key: "json", label: "JSON" }
    ],
    named_entity_recognition: [
        { key: "annotations", label: "Annotations" },
        { key: "json", label: "JSON" }
    ],
    natural_language_understanding: [
        { key: "intents", label: "Intents" },
        { key: "entities", label: "Entities" },
        { key: "json", label: "JSON" }
    ]
};

export const buildTabsFor = (kind) => BUILD_TABS[kind] || BUILD_TABS.text_classification;

// The tab a ?tab= value resolves to: itself when the kind has it, else the
// kind's first tab — so stale or foreign values never render an empty page.
export const buildTabFor = (kind, requested) => {
    const tabs = buildTabsFor(kind);
    return tabs.find((tab) => tab.key === requested) || tabs[0];
};
