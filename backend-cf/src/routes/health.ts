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

  // Check KV connectivity
  let kvStatus = 'unknown';
  try {
    // Try to read a test key
    await c.env.QUOTA_KV.get('health:check');
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
    // Check for orphaned sessions (sessions without corresponding users)
    const orphanedSessions = await c.env.DB.prepare(`
      SELECT COUNT(*) as count FROM sessions 
      WHERE user_id NOT IN (SELECT id FROM users)
    `).first();
    
    // Check for orphaned API keys
    const orphanedApiKeys = await c.env.DB.prepare(`
      SELECT COUNT(*) as count FROM api_keys 
      WHERE user_id NOT IN (SELECT id FROM users)
    `).first();
    
    // Check for orphaned usage logs
    const orphanedUsageLogs = await c.env.DB.prepare(`
      SELECT COUNT(*) as count FROM usage_logs 
      WHERE user_id NOT IN (SELECT id FROM users)
    `).first();
    
    // Count total users in D1
    const d1UserCount = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM users'
    ).first();
    
    // Count total sessions
    const sessionCount = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM sessions'
    ).first();
    
    // Get users with no email (potential data integrity issue)
    const usersWithoutEmail = await c.env.DB.prepare(`
      SELECT COUNT(*) as count FROM users 
      WHERE email IS NULL OR email = ''
    `).first();
    
    // Get recent failed webhook events (if we're storing them)
    // Note: This would require adding a webhook_failures table or KV storage
    
    // Calculate health score
    const issues = 
      (orphanedSessions?.count || 0) +
      (orphanedApiKeys?.count || 0) +
      (orphanedUsageLogs?.count || 0) +
      (usersWithoutEmail?.count || 0);
    
    const healthScore = issues === 0 ? 'healthy' : issues < 10 ? 'warning' : 'critical';
    
    return c.json({
      status: healthScore,
      timestamp: new Date().toISOString(),
      statistics: {
        totalUsers: d1UserCount?.count || 0,
        totalSessions: sessionCount?.count || 0,
        orphanedSessions: orphanedSessions?.count || 0,
        orphanedApiKeys: orphanedApiKeys?.count || 0,
        orphanedUsageLogs: orphanedUsageLogs?.count || 0,
        usersWithoutEmail: usersWithoutEmail?.count || 0
      },
      recommendations: generateRecommendations({
        orphanedSessions: orphanedSessions?.count || 0,
        orphanedApiKeys: orphanedApiKeys?.count || 0,
        orphanedUsageLogs: orphanedUsageLogs?.count || 0,
        usersWithoutEmail: usersWithoutEmail?.count || 0
      })
    });
  } catch (error) {
    console.error('Error checking data consistency:', error);
    return c.json({
      status: 'error',
      error: error.message
    }, 500);
  }
});

/**
 * Cleanup orphaned data endpoint
 * Admin only - removes orphaned records
 */
app.post('/cleanup-orphaned', adminMiddleware, async (c) => {
  try {
    // Delete orphaned sessions
    const sessionsResult = await c.env.DB.prepare(`
      DELETE FROM sessions 
      WHERE user_id NOT IN (SELECT id FROM users)
    `).run();
    
    // Delete orphaned API keys
    const apiKeysResult = await c.env.DB.prepare(`
      DELETE FROM api_keys 
      WHERE user_id NOT IN (SELECT id FROM users)
    `).run();
    
    // Delete orphaned usage logs
    const usageLogsResult = await c.env.DB.prepare(`
      DELETE FROM usage_logs 
      WHERE user_id NOT IN (SELECT id FROM users)
    `).run();
    
    return c.json({
      success: true,
      cleaned: {
        sessions: sessionsResult.meta.changes || 0,
        apiKeys: apiKeysResult.meta.changes || 0,
        usageLogs: usageLogsResult.meta.changes || 0
      },
      message: 'Orphaned data cleaned successfully'
    });
  } catch (error) {
    console.error('Error cleaning orphaned data:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * Generate recommendations based on consistency check results
 */
function generateRecommendations(issues: Record<string, number>): string[] {
  const recommendations: string[] = [];
  
  if (issues.orphanedSessions > 0) {
    recommendations.push(`Found ${issues.orphanedSessions} orphaned sessions. Run /api/health/cleanup-orphaned to remove them.`);
  }
  
  if (issues.orphanedApiKeys > 0) {
    recommendations.push(`Found ${issues.orphanedApiKeys} orphaned API keys. Run /api/health/cleanup-orphaned to remove them.`);
  }
  
  if (issues.orphanedUsageLogs > 0) {
    recommendations.push(`Found ${issues.orphanedUsageLogs} orphaned usage logs. Run /api/health/cleanup-orphaned to remove them.`);
  }
  
  if (issues.usersWithoutEmail > 0) {
    recommendations.push(`Found ${issues.usersWithoutEmail} users without email. Run /api/auth/sync-all-users to re-sync from Clerk.`);
  }
  
  if (recommendations.length === 0) {
    recommendations.push('No data consistency issues found. Database is healthy.');
  }
  
  return recommendations;
}

export default app;