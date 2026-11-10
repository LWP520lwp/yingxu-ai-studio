import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { Component, type ReactNode } from "react";
import { Atom, CaretDown, FolderSimple, Plus, SquaresFour } from "@phosphor-icons/react";
import type { DraftKind } from "./draftLibraryModel";

/** Keep navigation available when a workspace chunk or renderer fails. */
export class WorkspaceBoundary extends Component<{ children: ReactNode; name: string; resetKey: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(previous: Readonly<{ resetKey: string }>) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="workspace-loader" role="alert"><p>{this.props.name}暂时无法打开。</p><p>可以从导航返回草稿库。刷新应用会重新载入上次保存的内容。</p><button className="button secondary" onClick={() => window.location.reload()}>刷新应用</button></div>;
  }
}

export function DraftMenu({ onLibrary, onNew, disabled }: {
  onLibrary: (kind: DraftKind) => void; onNew: (kind: DraftKind) => void; disabled?: boolean;
}) {
  return <Dropdown.Root><Dropdown.Trigger className="draft-menu-trigger" aria-label="草稿菜单" disabled={disabled}>
    <FolderSimple size={18}/><CaretDown size={12}/>
  </Dropdown.Trigger><Dropdown.Portal><Dropdown.Content className="account-menu draft-menu" sideOffset={10} align="start" collisionPadding={12}>
    <Dropdown.Label className="draft-menu-label">我的草稿</Dropdown.Label>
    <Dropdown.Item onSelect={() => onLibrary("canvas")}><SquaresFour size={17}/>画布草稿</Dropdown.Item>
    <Dropdown.Item onSelect={() => onLibrary("science")}><Atom size={17}/>科普短视频草稿</Dropdown.Item>
    <Dropdown.Separator className="account-menu-separator"/>
    <Dropdown.Item onSelect={() => onNew("canvas")}><Plus size={17}/>新建画布</Dropdown.Item>
    <Dropdown.Item onSelect={() => onNew("science")}><Plus size={17}/>新建科普短视频</Dropdown.Item>
  </Dropdown.Content></Dropdown.Portal></Dropdown.Root>;
}

export function WorkspaceLoader({ name }: { name: string }) {
  return <div className="workspace-loader" role="status" aria-label={`正在载入${name}`}>
    <span>正在打开{name}…</span><div className="workspace-loader-layout" aria-hidden="true"><div/><div><span/><span/><span/></div></div>
  </div>;
}
