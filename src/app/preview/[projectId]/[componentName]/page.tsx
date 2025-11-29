'use client';

import { use } from 'react';

interface PageProps {
  params: Promise<{
    projectId: string;
    componentName: string;
  }>;
}

export default function ComponentPreviewPage({ params }: PageProps) {
  const { projectId, componentName } = use(params);

  return (
    <div className="min-h-screen bg-white">
      <div className="p-4">
        <div className="mb-4 text-sm text-gray-600">
          Preview: {componentName} (Project: {projectId})
        </div>
        <div className="border rounded-lg p-8">
          <p className="text-gray-500">Component preview under development</p>
        </div>
      </div>
    </div>
  );
}
