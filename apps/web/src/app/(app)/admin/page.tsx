"use client";

import { Building2, CheckCircle2, CircleAlert, Landmark, MapPinned, Network, Route, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api/client";
import type { OrganizationHierarchyNode, OrganizationHierarchyLevel, UnlinkedOrganizationHierarchyNode } from "@/lib/api/types";
import { formatCount, formatDateTime } from "@/lib/format";
import { useApiResource } from "@/lib/use-api-resource";
import { Card, ErrorState, LoadingState, PageHeader } from "@/components/ui";

function formatKm(value: string | number) {
  return new Intl.NumberFormat("uz-UZ", { maximumFractionDigits: 3 }).format(Number(value));
}

const levelLabels: Record<OrganizationHierarchyLevel, string> = {
  REPUBLIC: "Respublika",
  REGION: "Hudud",
  ENTERPRISE: "Korxona",
  DIVISION: "Yo‘l bo‘limi",
};

const unlinkedReasonLabels: Record<UnlinkedOrganizationHierarchyNode["reason"], string> = {
  ORGANIZATION_VERSION_MISSING_OR_INEFFECTIVE: "Tashkilotning amaldagi nom/kod versiyasi topilmadi",
  DIVISION_VERSION_MISSING_OR_INEFFECTIVE: "Yo‘l bo‘limining amaldagi nom/kod versiyasi topilmadi",
  REPUBLIC_PARENT_MISSING_OR_INEFFECTIVE: "Respublika bog‘lanishi topilmadi",
  REGION_CHAIN_MISSING_OR_INEFFECTIVE: "Hudud zanjiri topilmadi",
  ENTERPRISE_CHAIN_MISSING_OR_INEFFECTIVE: "Korxona zanjiri topilmadi",
};

function HierarchyBranch({ node }: { node: OrganizationHierarchyNode }) {
  return (
    <li>
      <div className={`admin-tree__node admin-tree__node--${node.level.toLowerCase()}`}>
        <span className="admin-tree__icon" aria-hidden="true">
          {node.level === "REPUBLIC" ? <Landmark /> : node.level === "DIVISION" ? <Route /> : <Building2 />}
        </span>
        <span>
          <small>{levelLabels[node.level]} · {node.code}</small>
          <strong>{node.name}</strong>
        </span>
      </div>
      {node.children.length > 0 ? (
        <ul>{node.children.map((child) => <HierarchyBranch key={child.id} node={child} />)}</ul>
      ) : null}
    </li>
  );
}

export default function AdminNetworkPage() {
  const network = useApiResource(api.adminNetworkSummary, "admin-network-summary");
  const hierarchy = useApiResource(api.adminOrganizationHierarchy, "admin-organization-hierarchy");

  return (
    <div className="page-stack">
      <PageHeader
        title="Respublika nazorati"
        description="Umumiy foydalanishdagi avtomobil yo‘llari bo‘yicha faqat tizim administratori ko‘radigan jamlanma."
      />
      <Card className="admin-scope-note">
        <ShieldCheck aria-hidden="true" />
        <div>
          <strong>Administrator doirasi</strong>
          <p>42 371 km ko‘rsatkichi yo‘l bo‘limlarining operativ sahifalariga uzatilmaydi.</p>
        </div>
      </Card>
      {network.loading ? <LoadingState /> : network.error ? <ErrorState error={network.error} retry={network.reload} /> : network.data ? (
        <>
          <div className="scope-meta">
            <span><strong>Daraja</strong>Respublika</span>
            <span><strong>Ma’lumot holati</strong>Sinxronlashtirilgan yozuvlar</span>
            <span><strong>Yangilangan</strong>{formatDateTime(network.data.asOf)}</span>
          </div>
          <div className="metric-grid admin-network-grid">
            <Card className="metric-card metric-card--navy">
              <span className="metric-card__icon"><Route aria-hidden="true" /></span>
              <div><strong>{formatKm(network.data.officialNetworkLengthKm)} km</strong><span>Rasmiy respublika tarmog‘i</span><small>Admin uchun bazaviy ko‘rsatkich</small></div>
            </Card>
            <Card className="metric-card metric-card--blue">
              <span className="metric-card__icon"><MapPinned aria-hidden="true" /></span>
              <div><strong>{formatKm(network.data.synchronizedRoadLengthKm)} km</strong><span>Tizimga sinxronlangan qamrov</span><small>Amaldagi yo‘l biriktirishlari yig‘indisi</small></div>
            </Card>
            <Card className="metric-card metric-card--teal">
              <span className="metric-card__icon"><Route aria-hidden="true" /></span>
              <div><strong>{formatCount(network.data.synchronizedRoadCount)}</strong><span>Sinxronlangan yo‘l</span><small>Takrorlanmagan yo‘l yozuvlari</small></div>
            </Card>
            <Card className="metric-card metric-card--amber">
              <span className="metric-card__icon"><Building2 aria-hidden="true" /></span>
              <div><strong>{formatCount(network.data.synchronizedDivisionCount)}</strong><span>Sinxronlangan yo‘l bo‘limi</span><small>Hozirgi ma’lumot qamrovi</small></div>
            </Card>
          </div>
        </>
      ) : null}

      <Card className="admin-hierarchy">
        <div className="section-heading">
          <span className="section-heading__icon"><Network aria-hidden="true" /></span>
          <div>
            <h2>Tashkiliy ierarxiya</h2>
            <p>Faqat tasdiqlangan manbadan sinxronlangan Respublika → hudud → korxona → yo‘l bo‘limi bog‘lanishlari.</p>
          </div>
        </div>
        {hierarchy.loading ? <LoadingState label="Tashkiliy daraxt yuklanmoqda" />
          : hierarchy.error ? <ErrorState error={hierarchy.error} retry={hierarchy.reload} />
            : hierarchy.data ? (
              <>
                <div className="admin-hierarchy__summary" aria-label="Ierarxiya qamrovi">
                  <span><strong>{formatCount(hierarchy.data.summary.synchronizedRepublicCount)}</strong>Respublika</span>
                  <span><strong>{formatCount(hierarchy.data.summary.synchronizedRegionCount)}</strong>Hudud</span>
                  <span><strong>{formatCount(hierarchy.data.summary.synchronizedEnterpriseCount)}</strong>Korxona</span>
                  <span><strong>{formatCount(hierarchy.data.summary.synchronizedDivisionCount)}</strong>Yo‘l bo‘limi</span>
                </div>
                <div className={`admin-hierarchy__status ${hierarchy.data.summary.hierarchyComplete ? "is-complete" : "is-warning"}`} role="status">
                  {hierarchy.data.summary.hierarchyComplete
                    ? <><CheckCircle2 aria-hidden="true" /><span><strong>Ierarxiya to‘liq</strong>Barcha amaldagi yozuvlar rasmiy zanjirga ulangan.</span></>
                    : <><CircleAlert aria-hidden="true" /><span><strong>Ierarxiya hali to‘liq emas</strong>{formatCount(hierarchy.data.summary.unlinkedNodeCount)} ta amaldagi yozuvda versiya yoki rasmiy tashkilot bog‘lanishi yetishmaydi.</span></>}
                </div>
                {hierarchy.data.tree.length > 0 ? (
                  <ul className="admin-tree" aria-label="Respublika tashkiliy daraxti">
                    {hierarchy.data.tree.map((node) => <HierarchyBranch key={node.id} node={node} />)}
                  </ul>
                ) : (
                  <div className="admin-hierarchy__empty">
                    <Network aria-hidden="true" />
                    <div><strong>Rasmiy ierarxiya hali sinxronlanmagan</strong><p>Tizim soxta korxona yoki yo‘l bo‘limi yaratmaydi. Vakolatli manba importi tasdiqlangach daraxt shu yerda chiqadi.</p></div>
                  </div>
                )}
                {hierarchy.data.unlinkedNodes.length > 0 ? (
                  <div className="admin-unlinked">
                    <h3>Bog‘lanishi kutilayotgan yozuvlar</h3>
                    <ul>{hierarchy.data.unlinkedNodes.map((node) => (
                      <li key={node.id}><span><strong>{node.name}</strong><small>{levelLabels[node.level]} · {node.code}</small></span><em>{unlinkedReasonLabels[node.reason]}</em></li>
                    ))}</ul>
                  </div>
                ) : null}
                <small className="admin-hierarchy__updated">Yangilangan: {formatDateTime(hierarchy.data.asOf)}</small>
              </>
            ) : null}
      </Card>
    </div>
  );
}
