#!/usr/bin/env node

/**
 * Build-time script to fetch public stats from the API
 * Run this before `next build` to bake stats into the static build
 */

const fs = require('fs');
const path = require('path');

const API_URL = process.env.API_URL || 'http://localhost:3001';
const OUTPUT_FILE = path.join(__dirname, '../src/data/stats.json');

async function fetchStats() {
  console.log(`Fetching stats from ${API_URL}/public-stats/stats...`);

  try {
    const response = await fetch(`${API_URL}/public-stats/stats`, {
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    const data = await response.json();

    // Format the stats for display
    const stats = {
      restaurantCount: formatNumber(data.totalTenants),
      orderCount: formatNumber(data.totalOrders),
      totalRevenue: formatCurrency(data.totalRevenue),
      fetchedAt: new Date().toISOString(),
    };

    // Ensure data directory exists
    const dataDir = path.dirname(OUTPUT_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(stats, null, 2));
    console.log(`Stats saved to ${OUTPUT_FILE}`);
    console.log(stats);

  } catch (error) {
    console.error('Failed to fetch stats:', error.message);
    console.log('Using default fallback values...');

    // Write fallback values
    const fallbackStats = {
      restaurantCount: '500+',
      orderCount: '10K+',
      totalRevenue: '₺1M+',
      fetchedAt: new Date().toISOString(),
      fallback: true,
    };

    const dataDir = path.dirname(OUTPUT_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(fallbackStats, null, 2));
    console.log(`Fallback stats saved to ${OUTPUT_FILE}`);
  }
}

function formatNumber(num) {
  if (!num || num === 0) return '500+';
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M+`;
  if (num >= 1000) return `${(num / 1000).toFixed(0)}K+`;
  return `${num}+`;
}

function formatCurrency(amount) {
  if (!amount || amount === 0) return '₺1M+';
  if (amount >= 1000000) return `₺${(amount / 1000000).toFixed(1)}M+`;
  if (amount >= 1000) return `₺${(amount / 1000).toFixed(0)}K+`;
  return `₺${amount.toFixed(0)}+`;
}

fetchStats();
