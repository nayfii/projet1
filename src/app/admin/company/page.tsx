import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireScope } from "@/lib/auth/guards";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { getCompany } from "@/modules/organizations/server/queries";
import { CompanyProfileForm } from "@/modules/organizations/ui/company-profile-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminNav");
  return { title: t("company") };
}

export default async function AdminCompanyPage() {
  const ctx = await requireScope("company");
  const t = await getTranslations("company");
  const company = await getCompany(ctx.active.companyId);
  if (!company) return null;
  return (
    <PageContainer className="max-w-2xl">
      <PageHeader title={t("title")} description={t("pageDescription")} />
      <Card>
        <CardContent>
          <CompanyProfileForm
            submitLabel={t("save")}
            initial={{
              name: company.name,
              industry: company.industry,
              sizeRange: company.size_range,
              website: company.website,
              description: company.description,
            }}
          />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
