import type { ThemeConfig } from "antd";
import { theme as antdTheme } from "antd";

const neutral = {
    light: {
        primary: "#236d56",
        primaryHover: "#1d604b",
        primaryText: "#ffffff",
        background: "#f5f7f9",
        containerBg: "#ffffff",
        elevatedBg: "#ffffff",
        border: "#dce2e8",
        mutedText: "#5e6c7b",
        itemHoverBg: "#e9edf2",
        itemSelectedBg: "#e3f3ec",
        itemSelectedHoverBg: "#d4eadf",
        itemText: "#18212b",
        tableSelectedBg: "#e3f3ec",
        tableSelectedHoverBg: "#d4eadf",
    },
    dark: {
        primary: "#87d8be",
        primaryHover: "#b5ebd9",
        primaryText: "#10221b",
        background: "#111418",
        containerBg: "#181c21",
        elevatedBg: "#20252c",
        border: "#2a3038",
        mutedText: "#a8b0bc",
        itemHoverBg: "#20252c",
        itemSelectedBg: "#22382f",
        itemSelectedHoverBg: "#2c473c",
        itemText: "#eef1f5",
        tableSelectedBg: "#22382f",
        tableSelectedHoverBg: "#2c473c",
    },
};

export function getAntThemeConfig(dark: boolean): ThemeConfig {
    const color = dark ? neutral.dark : neutral.light;

    return {
        algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        cssVar: { key: dark ? "infinite-canvas-dark" : "infinite-canvas-light" },
        token: {
            colorPrimary: color.primary,
            colorPrimaryHover: color.primaryHover,
            colorInfo: color.primary,
            colorLink: color.primary,
            colorLinkHover: color.primaryHover,
            colorLinkActive: color.primary,
            colorTextLightSolid: color.primaryText,
            colorText: color.itemText,
            colorTextSecondary: color.mutedText,
            colorBgBase: color.background,
            colorBgLayout: color.background,
            colorBgContainer: color.containerBg,
            colorBgElevated: color.elevatedBg,
            colorBorder: color.border,
            colorBorderSecondary: color.border,
            colorSplit: color.border,
            borderRadius: 8,
            fontFamily: '"Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
            controlItemBgHover: color.itemHoverBg,
            controlItemBgActive: color.itemSelectedBg,
            controlItemBgActiveHover: color.itemSelectedHoverBg,
        },
        components: {
            Button: {
                primaryShadow: "none",
            },
            Dropdown: {
                colorBgElevated: color.elevatedBg,
                colorText: color.itemText,
                controlItemBgHover: color.itemHoverBg,
                controlItemBgActive: color.itemSelectedBg,
                controlItemBgActiveHover: color.itemSelectedHoverBg,
            },
            Menu: {
                popupBg: color.elevatedBg,
                itemActiveBg: color.itemSelectedBg,
                itemHoverBg: color.itemHoverBg,
                itemSelectedBg: color.itemSelectedBg,
                itemSelectedColor: color.itemText,
                darkPopupBg: neutral.dark.elevatedBg,
                darkItemHoverBg: neutral.dark.itemHoverBg,
                darkItemSelectedBg: neutral.dark.itemSelectedBg,
                darkItemSelectedColor: neutral.dark.itemText,
            },
            Select: {
                optionActiveBg: color.itemHoverBg,
                optionSelectedBg: color.itemSelectedBg,
                optionSelectedColor: color.itemText,
            },
            Table: {
                rowSelectedBg: color.tableSelectedBg,
                rowSelectedHoverBg: color.tableSelectedHoverBg,
            },
        },
    };
}
