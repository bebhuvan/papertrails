// Enhanced logging utilities for both local and GitHub Actions
import fs from 'fs/promises';
import path from 'path';

class FeedLogger {
  constructor(system = 'unknown', batchName = null) {
    this.system = system; // 'local' or 'github-actions'
    this.batchName = batchName; // for GitHub Actions batches
    this.startTime = Date.now();
    this.metrics = {
      total: 0,
      successful: 0,
      failed: 0,
      substackSuccessful: 0,
      substackFailed: 0,
      newArticles: 0,
      failedFeeds: [],
      errors: [],
      runtime: 0
    };
  }

  log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    const system = this.batchName ? `${this.system}-${this.batchName}` : this.system;
    const logLine = `[${timestamp}] [${system}] [${level}] ${message}`;
    console.log(logLine);
    return logLine;
  }

  logFeedStart(feedName, index, total) {
    return this.log(`[${index}/${total}] Starting fetch: ${feedName}`);
  }

  logFeedSuccess(feedName, itemCount, newArticles) {
    this.metrics.successful++;
    if (feedName.includes('substack.com') || feedName.toLowerCase().includes('substack')) {
      this.metrics.substackSuccessful++;
    }
    this.metrics.newArticles += newArticles;
    return this.log(`✅ ${feedName}: ${itemCount} items, ${newArticles} new articles`);
  }

  logFeedFailure(feedName, feedUrl, error) {
    this.metrics.failed++;
    const isSubstack = feedUrl.includes('substack.com');
    if (isSubstack) {
      this.metrics.substackFailed++;
    }
    
    const failedFeed = {
      name: feedName,
      url: feedUrl,
      error: error.message,
      isSubstack,
      timestamp: new Date().toISOString()
    };
    
    this.metrics.failedFeeds.push(failedFeed);
    return this.log(`❌ ${feedName}: ${error.message}`, 'ERROR');
  }

  logError(message, error) {
    this.metrics.errors.push({
      message,
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    return this.log(`ERROR: ${message} - ${error.message}`, 'ERROR');
  }

  logGitOperation(operation, success, details = '') {
    const level = success ? 'INFO' : 'ERROR';
    const status = success ? '✅' : '❌';
    return this.log(`${status} Git ${operation}: ${details}`, level);
  }

  async generateSummary() {
    this.metrics.runtime = Math.round((Date.now() - this.startTime) / 1000 / 60 * 10) / 10; // minutes
    this.metrics.total = this.metrics.successful + this.metrics.failed;
    
    const successRate = this.metrics.total > 0 ? 
      Math.round(this.metrics.successful / this.metrics.total * 100) : 0;
    
    const substackTotal = this.metrics.substackSuccessful + this.metrics.substackFailed;
    const substackRate = substackTotal > 0 ? 
      Math.round(this.metrics.substackSuccessful / substackTotal * 100) : 0;

    const summary = {
      system: this.system,
      batchName: this.batchName,
      timestamp: new Date().toISOString(),
      metrics: {
        ...this.metrics,
        successRate: `${successRate}%`,
        substackSuccessRate: `${substackRate}%`,
        nonSubstackSuccessful: this.metrics.successful - this.metrics.substackSuccessful,
        nonSubstackFailed: this.metrics.failed - this.metrics.substackFailed
      }
    };

    // Log summary to console
    this.log('='.repeat(50));
    this.log(`SUMMARY - ${this.system.toUpperCase()}${this.batchName ? ` - ${this.batchName}` : ''}`);
    this.log(`Runtime: ${this.metrics.runtime} minutes`);
    this.log(`Total Success: ${this.metrics.successful}/${this.metrics.total} (${successRate}%)`);
    this.log(`Non-Substack: ${summary.metrics.nonSubstackSuccessful}/${summary.metrics.nonSubstackSuccessful + summary.metrics.nonSubstackFailed}`);
    this.log(`Substack: ${this.metrics.substackSuccessful}/${substackTotal} (${substackRate}%)`);
    this.log(`New Articles: ${this.metrics.newArticles}`);
    this.log(`Errors: ${this.metrics.errors.length}`);
    
    if (this.metrics.failedFeeds.length > 0) {
      this.log(`Failed Feeds: ${this.metrics.failedFeeds.map(f => f.name).join(', ')}`);
    }
    this.log('='.repeat(50));

    return summary;
  }

  async saveSummaryToFile(summary) {
    try {
      const logsDir = path.join(process.cwd(), 'logs');
      await fs.mkdir(logsDir, { recursive: true });

      const filename = `${this.system}${this.batchName ? `-${this.batchName}` : ''}-${new Date().toISOString().split('T')[0]}.json`;
      const filepath = path.join(logsDir, filename);
      
      // Load existing data if file exists
      let dailyLogs = [];
      try {
        const existing = await fs.readFile(filepath, 'utf-8');
        dailyLogs = JSON.parse(existing);
      } catch (e) {
        // File doesn't exist, start fresh
      }
      
      // Append new summary
      dailyLogs.push(summary);
      
      // Save updated logs
      await fs.writeFile(filepath, JSON.stringify(dailyLogs, null, 2));
      this.log(`📝 Summary saved to: ${filepath}`);
      
      return filepath;
    } catch (error) {
      this.log(`Failed to save summary: ${error.message}`, 'ERROR');
      return null;
    }
  }
}

export default FeedLogger;