import { useEffect, useRef } from "react";
import { Card, ListGroup, Spinner } from "react-bootstrap";
import { InfoCircle, Quote, Search } from "react-bootstrap-icons";
import { CardHeading, EmptyMessage } from "../../../../../shared/components/SectionCard";
import AnnotatedUtterance from "./AnnotatedUtterance";

// How close to the bottom of the scroll container (px) the next chunk starts
// loading, so it arrives a little before the user reaches the edge.
const LOAD_MORE_THRESHOLD = 200;

// The annotation workspace of a named entity recognition model: a bounded,
// scrollable list of model-scoped utterances that loads further chunks as the
// user scrolls, each annotatable in place. A sentinel at the bottom drives the
// loading via IntersectionObserver, so a first page that doesn't fill the
// container keeps topping up until it does (rather than getting stuck with no
// scrollbar to scroll).
const AnnotationWorkspace = ({
    loading,
    loadingMore,
    utterances,
    total,
    query,
    entities,
    suggestions,
    onAnnotate,
    onRemoveAnnotation,
    onEdit,
    onDelete,
    onAlert,
    onLoadMore
}) => {
    const scrollRef = useRef(null);
    const sentinelRef = useRef(null);
    // Keep the latest onLoadMore reachable without re-creating the observer
    // (its identity changes every parent render).
    const onLoadMoreRef = useRef(onLoadMore);
    onLoadMoreRef.current = onLoadMore;

    const hasMore = utterances.length < total;

    useEffect(() => {
        // Re-observe after each append (and skip while a load is in flight):
        // observing fires an initial callback with the sentinel's current
        // visibility, so a still-visible sentinel keeps the list filling.
        if (!hasMore || loadingMore) return undefined;
        const root = scrollRef.current;
        const sentinel = sentinelRef.current;
        if (!root || !sentinel) return undefined;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) onLoadMoreRef.current();
            },
            { root, rootMargin: `0px 0px ${LOAD_MORE_THRESHOLD}px 0px` }
        );
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [hasMore, loadingMore, utterances.length]);

    return (
        <Card className="border-light overflow-hidden h-100">
            <CardHeading
                icon={<Quote />}
                title="Utterances"
                right={
                    <span className="text-muted" style={{ fontSize: "0.7rem" }}>
                        {total} utterance{total === 1 ? "" : "s"}
                    </span>
                }
            />
            <div ref={scrollRef} className="overflow-auto" style={{ minHeight: "50vh", maxHeight: "50vh" }}>
                <ListGroup variant="flush" style={{ marginBottom: 0 }}>
                    {loading ? (
                        <ListGroup.Item
                            className="d-flex justify-content-center align-items-center"
                            style={{ minHeight: "50vh" }}
                        >
                            <Spinner animation="border" size="lg" />
                        </ListGroup.Item>
                    ) : total > 0 ? (
                        <>
                            {utterances.map((utterance, index) => (
                                <AnnotatedUtterance
                                    key={utterance.id}
                                    number={index + 1}
                                    utterance={utterance}
                                    entities={entities}
                                    suggestions={suggestions}
                                    onAnnotate={onAnnotate}
                                    onRemoveAnnotation={onRemoveAnnotation}
                                    onEdit={onEdit}
                                    onDelete={onDelete}
                                    onAlert={onAlert}
                                />
                            ))}
                            {loadingMore && (
                                <ListGroup.Item className="d-flex justify-content-center py-3">
                                    <Spinner animation="border" size="sm" />
                                </ListGroup.Item>
                            )}
                        </>
                    ) : query !== "" ? (
                        <ListGroup.Item
                            className="d-flex justify-content-center align-items-center"
                            style={{ minHeight: "50vh" }}
                        >
                            <EmptyMessage icon={<Search />}>
                                could not find the utterance you are looking for.
                            </EmptyMessage>
                        </ListGroup.Item>
                    ) : (
                        <ListGroup.Item
                            className="d-flex justify-content-center align-items-center"
                            style={{ minHeight: "50vh" }}
                        >
                            <EmptyMessage icon={<InfoCircle />}>
                                add an utterance, then select a phrase to tag it as an entity.
                            </EmptyMessage>
                        </ListGroup.Item>
                    )}
                </ListGroup>
                {hasMore && <div ref={sentinelRef} style={{ height: "1px" }} aria-hidden="true" />}
            </div>
        </Card>
    );
};

export default AnnotationWorkspace;
