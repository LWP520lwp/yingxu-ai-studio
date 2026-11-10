export type CanvasColorTheme = "light" | "dark";
export type CanvasBackgroundMode = "dots" | "lines" | "blank";

export const canvasThemes = {
    light: {
        canvas: {
            background: "#f5f7f9",
            dot: "rgba(94,108,123,.25)",
            line: "rgba(94,108,123,.12)",
            selectionStroke: "#236d56",
            selectionFill: "rgba(35,109,86,.07)",
        },
        node: {
            label: "#475667",
            fill: "#e9edf2",
            panel: "#ffffff",
            stroke: "#dce2e8",
            activeStroke: "#236d56",
            placeholder: "#708091",
            text: "#18212b",
            muted: "#5e6c7b",
            faint: "#8b98a6",
        },
        toolbar: {
            panel: "rgba(255,255,255,.98)",
            border: "#dce2e8",
            item: "#475667",
            itemHover: "#e9edf2",
            activeBg: "#e3f3ec",
            activeText: "#1d604b",
        },
    },
    dark: {
        canvas: {
            background: "#111418",
            dot: "rgba(168,176,188,.24)",
            line: "rgba(168,176,188,.10)",
            selectionStroke: "#87d8be",
            selectionFill: "rgba(135,216,190,.08)",
        },
        node: {
            label: "#c4cbd5",
            fill: "#20252c",
            panel: "#181c21",
            stroke: "#2a3038",
            activeStroke: "#87d8be",
            placeholder: "#8b96a5",
            text: "#eef1f5",
            muted: "#a8b0bc",
            faint: "#748191",
        },
        toolbar: {
            panel: "rgba(24,28,33,.98)",
            border: "#2a3038",
            item: "#c4cbd5",
            itemHover: "#20252c",
            activeBg: "#22382f",
            activeText: "#b5ebd9",
        },
    },
} as const;

export type CanvasTheme = (typeof canvasThemes)[CanvasColorTheme];
