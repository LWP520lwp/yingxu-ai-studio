export type CanvasColorTheme = "light" | "dark";
export type CanvasBackgroundMode = "dots" | "lines" | "blank";

type ThemePalette = {
    surface: string;
    raised: string;
    panel: string;
    edge: string;
    ink: string;
    secondaryInk: string;
    quietInk: string;
    accent: string;
    accentWash: string;
    grid: string;
    gridLine: string;
    selection: string;
    selectionWash: string;
};

function createTheme(palette: ThemePalette) {
    return {
        canvas: {
            background: palette.surface,
            dot: palette.grid,
            line: palette.gridLine,
            selectionStroke: palette.selection,
            selectionFill: palette.selectionWash,
        },
        node: {
            label: palette.secondaryInk,
            fill: palette.raised,
            panel: palette.panel,
            stroke: palette.edge,
            activeStroke: palette.selection,
            placeholder: palette.quietInk,
            text: palette.ink,
            muted: palette.secondaryInk,
            faint: palette.quietInk,
        },
        toolbar: {
            panel: palette.panel,
            border: palette.edge,
            item: palette.secondaryInk,
            itemHover: palette.raised,
            activeBg: palette.accentWash,
            activeText: palette.accent,
        },
    };
}

const palettes: Record<CanvasColorTheme, ThemePalette> = {
    light: {
        surface: "#f1f4f2",
        raised: "#e4eae7",
        panel: "#fcfdfc",
        edge: "#cbd6d1",
        ink: "#192522",
        secondaryInk: "#4d625b",
        quietInk: "#84958e",
        accent: "#a64e3c",
        accentWash: "#f6e7e1",
        grid: "rgba(48,72,62,.20)",
        gridLine: "rgba(48,72,62,.12)",
        selection: "#a64e3c",
        selectionWash: "rgba(166,78,60,.10)",
    },
    dark: {
        surface: "#111817",
        raised: "#202b28",
        panel: "#18211f",
        edge: "#364440",
        ink: "#edf3ef",
        secondaryInk: "#b0beb8",
        quietInk: "#82918a",
        accent: "#e59a72",
        accentWash: "#3d2d27",
        grid: "rgba(178,198,187,.19)",
        gridLine: "rgba(178,198,187,.11)",
        selection: "#e59a72",
        selectionWash: "rgba(229,154,114,.12)",
    },
};

export const canvasThemes = {
    light: createTheme(palettes.light),
    dark: createTheme(palettes.dark),
} as const;

export type CanvasTheme = (typeof canvasThemes)[CanvasColorTheme];
