import { MapEditor } from "@/components/editor/MapEditor";

export const metadata = { title: "New map - Smart Campus" };

export default function NewMapEditorPage() {
  return <MapEditor initialMap={null} />;
}
