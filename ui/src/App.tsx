import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MatrixView } from "@/views/MatrixView";
import { CrosscheckGraphView } from "@/views/CrosscheckGraphView";
import { UnknownsView } from "@/views/UnknownsView";

export function App() {
  return (
    <div className="mx-auto flex min-h-screen max-w-[1600px] flex-col gap-4 p-6">
      <header className="flex items-baseline justify-between border-b border-border pb-3">
        <div>
          <h1 className="text-lg font-semibold">wazuh-context-kit inspector</h1>
          <p className="text-xs text-muted-foreground">
            Phase 1.5 -- a reading and authoring instrument over the generated dataset, not an admin panel.
          </p>
        </div>
      </header>

      <Tabs defaultValue="matrix" className="flex flex-col gap-4">
        <TabsList>
          <TabsTrigger value="matrix">Matrix</TabsTrigger>
          <TabsTrigger value="crosscheck">Crosscheck graph</TabsTrigger>
          <TabsTrigger value="unknowns">Unknowns</TabsTrigger>
        </TabsList>
        <TabsContent value="matrix">
          <MatrixView />
        </TabsContent>
        <TabsContent value="crosscheck">
          <CrosscheckGraphView />
        </TabsContent>
        <TabsContent value="unknowns">
          <UnknownsView />
        </TabsContent>
      </Tabs>
    </div>
  );
}
