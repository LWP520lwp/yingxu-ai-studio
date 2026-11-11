export type CanvasColorTheme = "light" | "dark";
export type CanvasBackgroundMode = "dots" | "lines" | "blank";

export const canvasThemes = {
    light: {
        canvas: {
            background: "#eef3f8",
            dot: "rgba(44,62,84,.22)",
            line: "rgba(44,62,84,.10)",
            selectionStroke: "#0f766e",
            selectionFill: "rgba(15,118,110,.09)",
        },
        node: {
            label: "#42536a",
            fill: "#e2eaf3",
            panel: "#fbfdff",
            stroke: "#c9d5e2",
            activeStroke: "#0f766e",
            placeholder: "#74879c",
            text: "#172235",
            muted: "#60738a",
            faint: "#8ea0b5",
        },
        toolbar: {
            panel: "rgba(248,251,254,.96)",
            border: "#c9d5e2",
            item: "#42536a",
            itemHover: "#e3edf5",
            activeBg: "#d7f0ec",
            activeText: "#0f766e",
        },
    },
    dark: {
        canvas: {
            background: "#0b1120",
            dot: "rgba(145,169,199,.22)",
            line: "rgba(145,169,199,.085)",
            selectionStroke: "#61e6d2",
            selectionFill: "rgba(97,230,210,.10)",
        },
        node: {
            label: "#b8c9dd",
            fill: "#172338",
            panel: "#111b2c",
            stroke: "#2b3d57",
            activeStroke: "#61e6d2",
            placeholder: "#8094ad",
            text: "#e7f0fb",
            muted: "#9aadc3",
            faint: "#6f849e",
        },
        toolbar: {
            panel: "rgba(12,21,36,.96)",
            border: "#2b3d57",
            item: "#b8c9dd",
            itemHover: "#1a2c46",
            activeBg: "#113f46",
            activeText: "#8bf3df",
        },
    },
} as const;

export type CanvasTheme = (typeof canvasThemes)[CanvasColorTheme];
