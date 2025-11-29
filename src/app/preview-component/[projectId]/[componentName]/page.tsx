'use client';

import { use } from 'react';
import { notFound } from 'next/navigation';

interface PageProps {
  params: Promise<{
    projectId: string;
    componentName: string;
  }>;
}

export default function PreviewComponentPage({ params }: PageProps) {
  const { projectId, componentName } = use(params);

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-4">Component Preview</h1>
        <div className="bg-white rounded-lg shadow-md p-6">
          <p className="text-gray-600">
            Previewing component: <strong>{componentName}</strong>
          </p>
          <p className="text-gray-600 mt-2">
            Project ID: <strong>{projectId}</strong>
          </p>
          <p className="text-sm text-gray-500 mt-4">
            This feature is under development.
          </p>
        </div>
      </div>
    </div>
  );
}
