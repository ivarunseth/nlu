import { useRef } from "react";
import { Button, Card } from "react-bootstrap";
import { FiletypeCsv, FiletypePng } from "react-bootstrap-icons";
import { CardHeading } from "../../../../../shared/components/SectionCard";
import downloadBlob from "../../../../../shared/utils/downloadBlob";
import chartPng from "../../../../../shared/utils/chartPng";

const cell = (value) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

// Card around a chart with the CSV/PNG export affordances History ships.
// `csv` returns the rows (header first); `bar` is an optional control bar
// between the heading and the body; `foot` is a caption under the chart.
const ChartCard = ({ icon, title, name, right, bar, csv, foot, height = 300, children }) => {
    const wrap = useRef(null);

    const downloadCsv = () => {
        const rows = csv().map((row) => row.map(cell).join(",")).join("\n");
        downloadBlob(new Blob([rows], { type: "text/csv" }), `${name}.csv`);
    };

    const downloadPng = () => {
        chartPng(wrap.current?.querySelector("svg.recharts-surface"), `${name}.png`);
    };

    return (
        <Card className="border-light overflow-hidden h-100">
            <CardHeading
                icon={icon}
                title={title}
                right={
                    <span className="d-inline-flex align-items-center gap-2">
                        {right}
                        {csv && (
                            <Button variant="light" size="sm" className="border d-inline-flex align-items-center" title="Download CSV" onClick={downloadCsv}>
                                <FiletypeCsv />
                            </Button>
                        )}
                        <Button variant="light" size="sm" className="border d-inline-flex align-items-center" title="Download PNG" onClick={downloadPng}>
                            <FiletypePng />
                        </Button>
                    </span>
                }
            />
            {bar}
            <Card.Body className="p-3">
                <div ref={wrap} style={{ height, overflowY: "auto" }}>
                    {children}
                </div>
                {foot && (
                    <div className="text-muted mt-2" style={{ fontSize: "0.7rem" }}>{foot}</div>
                )}
            </Card.Body>
        </Card>
    );
};

export default ChartCard;
