import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function EditorFormSkeleton() {
  return (
    <div className="box-border min-h-[calc(100dvh-65px)] bg-slate-100 p-4 md:p-6">
      <div className="mx-auto mb-4 w-full max-w-[1700px]">
        <Skeleton className="h-4 w-40" />
      </div>

      <div className="mx-auto grid w-full max-w-[1700px] gap-6 lg:grid-cols-[440px_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardHeader className="space-y-4">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-5 w-40" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-[560px] w-full rounded-xl" />
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-start">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <Skeleton className="h-7 w-44" />
              </CardHeader>
              <CardContent className="space-y-4">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-24 w-full" />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <Skeleton className="h-7 w-40" />
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <Skeleton className="h-7 w-36" />
              </CardHeader>
              <CardContent className="space-y-4">
                <Skeleton className="h-28 w-full" />
                <Skeleton className="h-14 w-full" />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <Skeleton className="h-7 w-28" />
              </CardHeader>
              <CardContent className="space-y-4">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </CardContent>
            </Card>
          </div>

          <Card className="lg:self-start">
            <CardContent className="pt-0">
              <div className="flex flex-col gap-2">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
