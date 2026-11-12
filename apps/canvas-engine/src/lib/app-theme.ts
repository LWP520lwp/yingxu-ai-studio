import type { ThemeConfig } from "antd";
import { theme as antdTheme } from "antd";

interface SurfacePalette {
  accent: string;
  accentHover: string;
  accentText: string;
  canvas: string;
  panel: string;
  overlay: string;
  outline: string;
  subdued: string;
  hover: string;
  selected: string;
  selectedHover: string;
  text: string;
}

const surfaces: Record<"light" | "dark", SurfacePalette> = {
  light: {
    accent: "#176c5b",
    accentHover: "#0d5949",
    accentText: "#ffffff",
    canvas: "#f4f7f6",
    panel: "#ffffff",
    overlay: "#fafcfb",
    outline: "#d9e4e1",
    subdued: "#647773",
    hover: "#e9f1ef",
    selected: "#e1f4ed",
    selectedHover: "#c9e9dd",
    text: "#1b2b29",
  },
  dark: {
    accent: "#62d6b6",
    accentHover: "#8ce8cd",
    accentText: "#10231e",
    canvas: "#10171b",
    panel: "#151f24",
    overlay: "#1d2a30",
    outline: "#2b3b42",
    subdued: "#a6b6bc",
    hover: "#22343a",
    selected: "#26443d",
    selectedHover: "#31594e",
    text: "#e8f0f2",
  },
};

export function getAntThemeConfig(dark: boolean): ThemeConfig {
  const palette = surfaces[dark ? "dark" : "light"];
  const active = {
    controlItemBgActive: palette.selected,
    controlItemBgActiveHover: palette.selectedHover,
  };

  return {
    algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    cssVar: { key: dark ? "yingxu-atlas-dark" : "yingxu-atlas-light" },
    token: {
      colorPrimary: palette.accent,
      colorPrimaryHover: palette.accentHover,
      colorInfo: palette.accent,
      colorLink: palette.accent,
      colorLinkHover: palette.accentHover,
      colorLinkActive: palette.accent,
      colorTextLightSolid: palette.accentText,
      colorText: palette.text,
      colorTextSecondary: palette.subdued,
      colorBgBase: palette.canvas,
      colorBgLayout: palette.canvas,
      colorBgContainer: palette.panel,
      colorBgElevated: palette.overlay,
      colorBorder: palette.outline,
      colorBorderSecondary: palette.outline,
      colorSplit: palette.outline,
      borderRadius: 8,
      fontFamily: '"Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
      controlItemBgHover: palette.hover,
      ...active,
    },
    components: {
      Button: { primaryShadow: "none" },
      Dropdown: {
        colorBgElevated: palette.overlay,
        colorText: palette.text,
        controlItemBgHover: palette.hover,
        ...active,
      },
      Menu: {
        popupBg: palette.overlay,
        itemActiveBg: palette.selected,
        itemHoverBg: palette.hover,
        itemSelectedBg: palette.selected,
        itemSelectedColor: palette.text,
        darkPopupBg: surfaces.dark.overlay,
        darkItemHoverBg: surfaces.dark.hover,
        darkItemSelectedBg: surfaces.dark.selected,
        darkItemSelectedColor: surfaces.dark.text,
      },
      Select: {
        optionActiveBg: palette.hover,
        optionSelectedBg: palette.selected,
        optionSelectedColor: palette.text,
      },
      Table: {
        rowSelectedBg: palette.selected,
        rowSelectedHoverBg: palette.selectedHover,
      },
    },
  };
}
