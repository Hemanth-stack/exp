/**
 * Default placeholder page - will be replaced by user's component code
 */
export default function Page() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-purple-50">
      <div className="text-center space-y-6 p-8">
        <div className="animate-pulse">
          <div className="w-16 h-16 bg-blue-500 rounded-full mx-auto mb-4"></div>
        </div>
        <h1 className="text-4xl font-bold text-gray-800">
          Sandbox Preview
        </h1>
        <p className="text-gray-600 max-w-md">
          This is a placeholder component. Your generated component will appear here once loaded.
        </p>
        <div className="flex items-center justify-center space-x-2 text-sm text-gray-500">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
          <span>Container is running</span>
        </div>
      </div>
    </div>
  )
}
