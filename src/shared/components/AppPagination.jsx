import { Pagination } from "react-bootstrap";

const getVisiblePageItems = (page, totalPages, maxVisiblePages) => {
    const items = [];
    const halfWindow = Math.floor(maxVisiblePages / 2);

    for (let i = 1; i <= totalPages; i += 1) {
        const isVisible =
            i === 1 ||
            i === totalPages ||
            (i >= page - halfWindow && i <= page + halfWindow);

        if (isVisible) {
            items.push(i);
        } else if (items[items.length - 1] !== "ellipsis") {
            items.push("ellipsis");
        }
    }

    return items;
};

const AppPagination = ({ page, total, perPage, maxVisiblePages = 5, onPageChange }) => {
    const totalPages = Math.ceil(total / perPage);

    if (totalPages <= 1) {
        return null;
    }

    return (
        <Pagination>
            <Pagination.Prev
                onClick={() => onPageChange(Math.max(page - 1, 1))}
                disabled={page === 1}
            />
            {getVisiblePageItems(page, totalPages, maxVisiblePages).map((item, index) => (
                item === "ellipsis" ? (
                    <Pagination.Ellipsis key={`ellipsis-${index}`} />
                ) : (
                    <Pagination.Item
                        key={item}
                        active={item === page}
                        onClick={() => onPageChange(item)}
                    >
                        {item}
                    </Pagination.Item>
                )
            ))}
            <Pagination.Next
                onClick={() => onPageChange(Math.min(page + 1, totalPages))}
                disabled={page === totalPages}
            />
        </Pagination>
    );
};

export default AppPagination;
