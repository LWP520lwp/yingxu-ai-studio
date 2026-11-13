import {
  FileText,
  Group,
  Image as ImageIcon,
  Music2,
  Settings2,
  Video,
} from "lucide-react";

import { buildBuiltinNodeDefinitions } from "@/atlas-engine/model/builtin-node-definitions";
import { registerAtlasNodeDefinitions as registerNodeDefinitions } from "@/atlas-engine/model/node-registry";
import { CanvasNodeType } from "@/types/canvas";
import { COMPOSITION_NODE_DEFINITION } from "./composition-node";

const ICONS = {
  [CanvasNodeType.Text]: <FileText className="size-4" />,
  [CanvasNodeType.Image]: <ImageIcon className="size-4" />,
  [CanvasNodeType.Config]: <Settings2 className="size-4" />,
  [CanvasNodeType.Video]: <Video className="size-4" />,
  [CanvasNodeType.Audio]: <Music2 className="size-4" />,
  [CanvasNodeType.Group]: <Group className="size-4" />,
};

let registered = false;
export function registerBuiltinNodes() {
  if (registered) return;
  const definitions = buildBuiltinNodeDefinitions(ICONS);
  registerNodeDefinitions(
    [...definitions, COMPOSITION_NODE_DEFINITION],
    "builtin",
  );
  registered = true;
}
