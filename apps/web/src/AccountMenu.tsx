import * as Dropdown from "@radix-ui/react-dropdown-menu";
import {
  GearSix,
  GithubLogo,
  Lightning,
  SignOut,
  Stack,
  UserCircle,
} from "@phosphor-icons/react";
import type { User } from "./types";

export function AccountMenu({
  user,
  onAccount,
  onPool,
  onSkills,
  onSettings,
  onLogout,
}: {
  user: User | null;
  onAccount: () => void;
  onPool: () => void;
  onSkills: () => void;
  onSettings: () => void;
  onLogout: () => void;
}) {
  return (
    <Dropdown.Root>
      <Dropdown.Trigger
        className="avatar"
        aria-label={user ? "账户菜单" : "登录与账户菜单"}
      >
        {user?.name?.slice(0, 1) || <GithubLogo size={23} />}
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          className="account-menu"
          side="right"
          align="end"
          sideOffset={12}
          collisionPadding={12}
        >
          <Dropdown.Label className="account-menu-label">
            <strong>{user?.name || "欢迎来到映序"}</strong>
            <span>
              {user
                ? user.provider === "github"
                  ? "GitHub 账户"
                  : user.provider === "reviewer" ? "受邀访问账号" : "本机工作空间"
                : "登录后保存你的创作"}
            </span>
          </Dropdown.Label>
          <Dropdown.Separator className="account-menu-separator" />
          <Dropdown.Item onSelect={onAccount}>
            <UserCircle size={17} />
            {user ? "账户信息" : "登录 / 注册"}
          </Dropdown.Item>
          <Dropdown.Item onSelect={onSkills}>
            <Lightning size={17} />
            Skill 市场
          </Dropdown.Item>
          <Dropdown.Item onSelect={onPool}>
            <Stack size={17} />
            我的账号池
          </Dropdown.Item>
          <Dropdown.Item onSelect={onSettings}>
            <GearSix size={17} />
            工作台设置
          </Dropdown.Item>
          {user && (
            <>
              <Dropdown.Separator className="account-menu-separator" />
              <Dropdown.Item onSelect={onLogout}>
                <SignOut size={17} />
                退出登录
              </Dropdown.Item>
            </>
          )}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
