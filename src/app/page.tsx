import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Sparkles, Zap, Shield, Code } from 'lucide-react';

export default function HomePage() {
  return (
    <div className="min-h-screen">
      {/* Navigation */}
      <nav className="border-b">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <Sparkles className="h-8 w-8 text-primary" />
            <span className="text-2xl font-bold">AI App Builder</span>
          </div>
          <div className="flex space-x-4">
            <Link href="/login">
              <Button variant="ghost">Login</Button>
            </Link>
            <Link href="/register">
              <Button>Get Started</Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="py-20 px-4">
        <div className="container mx-auto text-center">
          <h1 className="text-6xl font-bold mb-6 bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            Build Apps with AI
          </h1>
          <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            Transform your ideas into production-ready applications using the power of AI.
            No complex setup, just pure innovation.
          </p>
          <div className="flex justify-center space-x-4">
            <Link href="/register">
              <Button size="lg" className="text-lg">
                Start Building Free
              </Button>
            </Link>
            <Link href="/login">
              <Button size="lg" variant="outline" className="text-lg">
                View Demo
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 px-4 bg-muted/50">
        <div className="container mx-auto">
          <h2 className="text-4xl font-bold text-center mb-12">Why Choose Us</h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-card p-8 rounded-lg shadow-sm">
              <Zap className="h-12 w-12 text-primary mb-4" />
              <h3 className="text-2xl font-semibold mb-4">Lightning Fast</h3>
              <p className="text-muted-foreground">
                Deploy your applications in seconds with our optimized container infrastructure.
              </p>
            </div>
            <div className="bg-card p-8 rounded-lg shadow-sm">
              <Shield className="h-12 w-12 text-primary mb-4" />
              <h3 className="text-2xl font-semibold mb-4">Secure & Reliable</h3>
              <p className="text-muted-foreground">
                Enterprise-grade security with isolated environments for each project.
              </p>
            </div>
            <div className="bg-card p-8 rounded-lg shadow-sm">
              <Code className="h-12 w-12 text-primary mb-4" />
              <h3 className="text-2xl font-semibold mb-4">Full Control</h3>
              <p className="text-muted-foreground">
                Access your code, customize templates, and deploy anywhere you want.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-4">
        <div className="container mx-auto text-center">
          <h2 className="text-4xl font-bold mb-6">Ready to Get Started?</h2>
          <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            Join thousands of developers building the next generation of applications.
          </p>
          <Link href="/register">
            <Button size="lg" className="text-lg">
              Create Your Free Account
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8">
        <div className="container mx-auto px-4 text-center text-muted-foreground">
          <p>&copy; 2025 AI App Builder. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
