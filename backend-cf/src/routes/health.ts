/**
 * Health check route
 * Provides system status and environment information
 */

import { Hono } from 'hono';
import { Env } from '../types';
import { adminMiddleware } from '../middleware/auth';

const app = new Hono<{ Bindings: Env }>();

/**
 * Health check endpoint
 * Returns system status and environment information
 */
app.get('/', async (c) => {
  // Check database connectivity
  let dbStatus = 'unknown';
  try {
    const result = await c.env.DB.prepare('SELECT 1 as test').first();
    dbStatus = result ? 'healthy' : 'unhealthy';
  } catch (error) {
    dbStatus = 'error';
  }

  // Check KV connectivity (Wallet Cache)
  let kvStatus = 'unknown';
  try {
    // Try to read a test key from wallet cache
    await c.env.WALLET_CACHE.get('health:check');
    kvStatus = 'healthy';
  } catch (error) {
    kvStatus = 'error';
  }

  // Get environment info
  const environment = c.env.ENVIRONMENT || 'unknown';
  const domain = c.env.FRONTEND_URL ? new URL(c.env.FRONTEND_URL).hostname : 'unknown';

  return c.json({
    status: 'ok',
    environment,
    domain,
    timestamp: new Date().toISOString(),
    services: {
      database: dbStatus,
      kv_storage: kvStatus
    },
    version: '1.0.0',
    api_endpoints: {
      development: 'https://sokuji-api-dev.kizuna.ai',
      production: 'https://sokuji-api.kizuna.ai'
    }
  });
});

/**
 * Simple ping endpoint
 */
app.get('/ping', (c) => {
  return c.text('pong');
});

/**
 * Data consistency check endpoint
 * Admin only - checks for data inconsistencies between Clerk and D1
 */
app.get('/data-consistency', adminMiddleware, async (c) => {
  try {
    // Check for orphaned usage logs
    const orphanedUsageLogs = await c.env.DB.prepare(`
      SELECT COUNT(*) as count FROM usage_logs 
      WHERE subject_type = 'user' 
      AND subject_id NOT IN (SELECT clerk_id FROM users)
    `).first();
    
    // Check for orphaned wallet entries
    const orphanedWallets = await c.env.DB.prepare(`
      SELECT COUNT(*) as count FROM wallets 
      WHERE subject_type = 'user' 
      AND subject_id NOT IN (SELECT clerk_id FROM users)
    `).first();
    
    // Count total users in D1
    const d1UserCount = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM users'
    ).first();
    
    // Count total wallets
    const walletCount = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM wallets'
    ).first();
    
    // Get users with no email (potential data integrity issue)
    const usersWithoutEmail = await c.env.DB.prepare(`
      SELECT COUNT(*) as count FROM users 
      WHERE email IS NULL OR email = ''
    `).first();
    
    // Get users without wallets
    const usersWithoutWallets = await c.env.DB.prepare(`
      SELECT COUNT(*) as count FROM users 
      WHERE clerk_id NOT IN (
        SELECT subject_id FROM wallets WHERE subject_type = 'user'
      )
    `).first();
    
    // Calculate health score
    const issues = 
      (Number(orphanedUsageLogs?.count) || 0) +
      (Number(orphanedWallets?.count) || 0) +
      (Number(usersWithoutEmail?.count) || 0) +
      (Number(usersWithoutWallets?.count) || 0);
    
    const healthScore = issues === 0 ? 'healthy' : issues < 10 ? 'warning' : 'critical';
    
    return c.json({
      status: healthScore,
      timestamp: new Date().toISOString(),
      statistics: {
        totalUsers: d1UserCount?.count || 0,
        totalWallets: walletCount?.count || 0,
        orphanedUsageLogs: orphanedUsageLogs?.count || 0,
        orphanedWallets: orphanedWallets?.count || 0,
        usersWithoutEmail: usersWithoutEmail?.count || 0,
        usersWithoutWallets: usersWithoutWallets?.count || 0
      },
      recommendations: generateRecommendations({
        orphanedUsageLogs: Number(orphanedUsageLogs?.count) || 0,
        orphanedWallets: Number(orphanedWallets?.count) || 0,
        usersWithoutEmail: Number(usersWithoutEmail?.count) || 0,
        usersWithoutWallets: Number(usersWithoutWallets?.count) || 0
      })
    });
  } catch (error) {
    console.error('Error checking data consistency:', error);
    return c.json({
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

/**
 * Cleanup orphaned data endpoint
 * Admin only - removes orphaned records
 */
app.post('/cleanup-orphaned', adminMiddleware, async (c) => {
  try {
    // Delete orphaned usage logs
    const usageLogsResult = await c.env.DB.prepare(`
      DELETE FROM usage_logs 
      WHERE subject_type = 'user' 
      AND subject_id NOT IN (SELECT clerk_id FROM users)
    `).run();
    
    // Delete orphaned wallets
    const walletsResult = await c.env.DB.prepare(`
      DELETE FROM wallets 
      WHERE subject_type = 'user' 
      AND subject_id NOT IN (SELECT clerk_id FROM users)
    `).run();
    
    // Clear any orphaned cache entries
    const { createWalletService } = await import('../services/wallet');
    const walletService = createWalletService(c.env);
    
    // Get list of orphaned wallet IDs to clear cache
    const orphanedWalletIds = await c.env.DB.prepare(`
      SELECT subject_id FROM wallets 
      WHERE subject_type = 'user' 
      AND subject_id NOT IN (SELECT clerk_id FROM users)
    `).all();
    
    // Clear cache for orphaned wallets
    for (const wallet of orphanedWalletIds.results || []) {
      await walletService.invalidateCache('user', wallet.subject_id as string);
    }
    
    return c.json({
      success: true,
      cleaned: {
        usageLogs: usageLogsResult.meta.changes || 0,
        wallets: walletsResult.meta.changes || 0,
        cacheEntries: orphanedWalletIds.results?.length || 0
      },
      message: 'Orphaned data cleaned successfully'
    });
  } catch (error) {
    console.error('Error cleaning orphaned data:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

/**
 * Generate recommendations based on consistency check results
 */
function generateRecommendations(issues: Record<string, number>): string[] {
  const recommendations: string[] = [];
  
  if (issues.orphanedUsageLogs > 0) {
    recommendations.push(`Found ${issues.orphanedUsageLogs} orphaned usage logs. Run /api/health/cleanup-orphaned to remove them.`);
  }
  
  if (issues.orphanedWallets > 0) {
    recommendations.push(`Found ${issues.orphanedWallets} orphaned wallets. Run /api/health/cleanup-orphaned to remove them.`);
  }
  
  if (issues.usersWithoutEmail > 0) {
    recommendations.push(`Found ${issues.usersWithoutEmail} users without email. Run /api/auth/sync-all-users to re-sync from Clerk.`);
  }
  
  if (issues.usersWithoutWallets > 0) {
    recommendations.push(`Found ${issues.usersWithoutWallets} users without wallets. These will be created automatically on next use.`);
  }
  
  if (recommendations.length === 0) {
    recommendations.push('No data consistency issues found. Database is healthy.');
  }
  
  return recommendations;
}

export default app;