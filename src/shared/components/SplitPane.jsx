import { GripVertical } from "react-bootstrap-icons";
import useSplitPane from "../hooks/useSplitPane";

// Gutter width (px) between the two panels; also the drag handle's width.
const SPLIT_GUTTER = 16;

// Two panels side by side with a draggable divider (double-click resets),
// collapsing to a stacked full-width column below the lg breakpoint. `left`
// and `right` are the panel contents; the split is the left panel's width
// percentage. Shared by the annotation-style Build layouts so the NER
// entities/utterances split and the language understanding slots/utterances
// split are pixel-for-pixel the same.
const SplitPane = ({ left, right, className = "", ...options }) => {
    const { splitPct, isWide, splitRef, startDrag, resetSplit } = useSplitPane(options);

    return (
        <div
            ref={splitRef}
            className={`d-flex ${isWide ? "flex-row align-items-stretch" : "flex-column gap-3"} ${className}`}
        >
            <div
                className="d-flex flex-column"
                style={isWide
                    ? { flex: `0 0 calc(${splitPct}% - ${SPLIT_GUTTER / 2}px)`, minWidth: 0 }
                    : { width: "100%" }}
            >
                {left}
            </div>

            {isWide && (
                <div
                    role="separator"
                    aria-orientation="vertical"
                    onMouseDown={startDrag}
                    onTouchStart={startDrag}
                    onDoubleClick={resetSplit}
                    title="Drag to resize · double-click to reset"
                    className="d-flex align-items-center justify-content-center flex-shrink-0 text-body-secondary"
                    style={{ width: `${SPLIT_GUTTER}px`, cursor: "col-resize", touchAction: "none", alignSelf: "stretch" }}
                >
                    <GripVertical size={16} />
                </div>
            )}

            <div
                className="d-flex flex-column"
                style={isWide
                    ? { flex: `1 1 calc(${100 - splitPct}% - ${SPLIT_GUTTER / 2}px)`, minWidth: 0 }
                    : { width: "100%" }}
            >
                {right}
            </div>
        </div>
    );
};

export default SplitPane;
