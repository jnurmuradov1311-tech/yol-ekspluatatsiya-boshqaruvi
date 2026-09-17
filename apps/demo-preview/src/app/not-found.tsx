import Link from "next/link";

export default function NotFoundPage() {
  return <main className="fatal-error"><h1>Sahifa topilmadi</h1><p>Manzilni tekshiring yoki bosh sahifaga qayting.</p><Link className="button button--primary" href="/dashboard">Dashboardga qaytish</Link></main>;
}
