'use client';

import { signIn } from 'next-auth/react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Shirt, Heart, Search, Filter, Camera, Sparkles, Star, Zap, Shield } from "lucide-react"
import Image from "next/image"


export default function LoginPage() {
  const [email, setEmail] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await signIn('email', { email, callbackUrl: '/' });
  };


    return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100">
      {/* Header */}
      <header className="container mx-auto py-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-gradient-to-br from-slate-800 to-slate-600 rounded-lg flex items-center justify-center">
              <Shirt className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">
              MyWardrobe
            </span>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="container mx-auto px-4 py-40">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Left Column - Content */}
          <div className="space-y-8">
            <div className="space-y-4">
              <h1 className="text-4xl lg:text-6xl font-bold leading-tight">
                My{" "}
                <span className="bg-gradient-to-r from-slate-800 to-blue-600 bg-clip-text text-transparent">
                  Digital Wardrobe
                </span>{" "}
              </h1>
              <p className="text-xl text-slate-600 leading-relaxed">
                Organize, discover, and style your entire wardrobe digitally. Never forget what you own, create perfect
                outfits, and make every piece count.
              </p>
            </div>

            {/* Features Grid */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center space-x-3 p-3 rounded-lg bg-white/50 border border-slate-200">
                <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center">
                  <Camera className="w-4 h-4 text-slate-600" />
                </div>
                <span className="text-sm font-medium">Photo Management</span>
              </div>
              <div className="flex items-center space-x-3 p-3 rounded-lg bg-white/50 border border-slate-200">
                <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                  <Heart className="w-4 h-4 text-blue-600" />
                </div>
                <span className="text-sm font-medium">Favorites System</span>
              </div>
              <div className="flex items-center space-x-3 p-3 rounded-lg bg-white/50 border border-slate-200">
                <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                  <Search className="w-4 h-4 text-blue-600" />
                </div>
                <span className="text-sm font-medium">Edit Details</span>
              </div>
              <div className="flex items-center space-x-3 p-3 rounded-lg bg-white/50 border border-slate-200">
                <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                  <Filter className="w-4 h-4 text-green-600" />
                </div>
                <span className="text-sm font-medium">Advanced Filters</span>
              </div>
            </div>
          </div>

          {/* Right Column - Login Form */}
          <div className="lg:pl-8">
            <Card className="w-full max-w-md mx-auto shadow-2xl border-0 bg-white/80 backdrop-blur-sm">
              <CardHeader className="text-center space-y-4">
                <div className="w-16 h-16 bg-gradient-to-br from-slate-700 to-blue-600 rounded-2xl flex items-center justify-center mx-auto">
                  <Zap className="w-8 h-8 text-white" />
                </div>
                <div>
                  <CardTitle className="text-2xl font-bold">Welcome Back</CardTitle>
                  <CardDescription className="text-base mt-2">
                    Access your wardrobe with a secure magic link
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <form className="space-y-4" onSubmit={handleSubmit}>
                  <div className="space-y-2">
                    <Input
                      id="email"
                      type="email"
                      placeholder="Enter your email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                  <Button
                    type="submit"
                    className="w-full h-12 text-base bg-gradient-to-r from-slate-700 to-blue-600 hover:from-slate-800 hover:to-blue-700 shadow-lg"
                  >
                    <Zap className="w-4 h-4 mr-2" />
                    Send Magic Link
                  </Button>
                </form>

                <div className="flex items-center space-x-2 text-xs text-slate-500 bg-slate-50 p-3 rounded-lg">
                  <Shield className="w-4 h-4" />
                  <span>Secure, passwordless authentication via email</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  )

  /*
  return (
    <div className="flex justify-center items-center h-screen bg-gray-100">
      <Card className="w-[400px]">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Welcome to MyWardrobe</CardTitle>
          <CardDescription className="text-base">Sign in to your account using a magic link.</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent>
            <div className="grid w-full items-center gap-4">
              <div className="flex flex-col space-y-1.5 mb-6">
                <Label htmlFor="email" className="text-sm">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex justify-center">
            <Button type="submit" className="w-full">Send Magic Link</Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
  */
}
