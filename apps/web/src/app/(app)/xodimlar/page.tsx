import { ResourceListPage } from "@/components/resource-list-page";

export default function WorkersPage() {
  return <ResourceListPage kind="workers" title="Xodimlar" description="Yo‘l ta’mirlash punktidan olingan, yo‘l bo‘limiga biriktirilgan ishchilar." emptyTitle="Xodim topilmadi" emptyDetail="Manba tizimi bilan almashinuvni tekshiring." />;
}
