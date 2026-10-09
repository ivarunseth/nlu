// The slots that reference one entity, and the intent each belongs to.
//
// Slots exist so one entity can be reused under a different role per intent —
// `city` filling both `departure_city` and `arrival_city`. That mapping is
// assigned on the slot itself; this is the one place it is read back the other
// way round, so the entity view can answer "what is this used for?" without the
// relationship being restated across the rest of the workspace.

import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Alert, Badge, Card, Spinner, Table } from "react-bootstrap";
import { Diagram3 } from "react-bootstrap-icons";
import { useParams } from "react-router-dom";
import { useApi } from "../../../../../contexts/ApiContext";

import { UserContext } from "../../../../../contexts/UserContext";
import AppPagination from "../../../../../shared/components/AppPagination";
import { CardHeading, EmptyMessage } from "../../../../../shared/components/SectionCard";

const PER_PAGE = 10;
const MAX_VISIBLE_PAGES = 5;

const EntitySlots = ({ entityId }) => {
    const { modelId } = useParams();
    const { user } = useContext(UserContext);

    const [slots, setSlots] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [page, setPage] = useState(1);

    const api = useApi();

    const getSlots = useCallback(async () => {
        try {
            setLoading(true);
            const { slots: entitySlots } = await api.slots.list(modelId, { entity: entityId });
            setSlots(entitySlots || []);
            setError(null);
        } catch (failure) {
            setError(failure?.response?.data?.error || "Could not load slots.");
        } finally {
            setLoading(false);
        }
    }, [api, modelId, entityId]);

    useEffect(() => {
        if (user && modelId && entityId) getSlots();
    }, [user, modelId, entityId, getSlots]);

    // Ordered by intent so the table reads as "under this intent, this entity
    // plays these roles" — the question the mapping exists to answer.
    const rows = useMemo(() => [...slots].sort((a, b) => (
        (a.intent?.name || "").localeCompare(b.intent?.name || "")
        || a.name.localeCompare(b.name)
    )), [slots]);

    const intents = useMemo(
        () => new Set(rows.map((slot) => slot.intent?.id).filter(Boolean)).size,
        [rows]
    );

    const pagedRows = rows.slice((page - 1) * PER_PAGE, page * PER_PAGE);

    return (
        <>
            <Card className="border-light overflow-hidden mt-3">
                <CardHeading
                    icon={<Diagram3 />}
                    title="Slots"
                    right={
                        <span className="text-muted" style={{ fontSize: "var(--app-text-xs)" }}>
                            {rows.length} slot{rows.length === 1 ? "" : "s"} across {intents} intent{intents === 1 ? "" : "s"}
                        </span>
                    }
                />
                <Card.Body className="p-0">
                    {error && <Alert variant="danger" className="m-3 small">{error}</Alert>}
                    {loading ? (
                        <div className="text-center py-4"><Spinner size="sm" /></div>
                    ) : rows.length > 0 ? (
                        <Table responsive hover className="mb-0 align-middle">
                            <thead>
                                <tr>
                                    <th>Intent</th>
                                    <th>Slot</th>
                                    <th className="text-center">Annotations</th>
                                </tr>
                            </thead>
                            <tbody>
                                {pagedRows.map((slot) => (
                                    <tr key={slot.id}>
                                        <td>{slot.intent?.name || "—"}</td>
                                        <td>{slot.name}</td>
                                        <td className="text-center">
                                            <Badge bg="light" text="dark" className="border">
                                                {slot.annotations_count ?? 0}
                                            </Badge>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </Table>
                    ) : (
                        <EmptyMessage>
                            no slot maps to this entity yet — assign it when creating a slot on an intent.
                        </EmptyMessage>
                    )}
                </Card.Body>
            </Card>
            {rows.length > 0 && (
                <div className="mt-3">
                    <AppPagination
                        page={page}
                        total={rows.length}
                        perPage={PER_PAGE}
                        maxVisiblePages={MAX_VISIBLE_PAGES}
                        onPageChange={setPage}
                    />
                </div>
            )}
        </>
    );
};

export default EntitySlots;
