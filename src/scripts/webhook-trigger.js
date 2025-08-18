#!/usr/bin/env node
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Configuration
const GITHUB_CONFIG = {
  owner: process.env.GITHUB_OWNER || 'your-username', // Update this
  repo: process.env.GITHUB_REPO || 'paper-trails',   // Update this
  workflow: 'deploy.yml', // or your deploy workflow filename
  token: process.env.GITHUB_TOKEN // Set this in your environment
};

async function triggerDeploy() {
  console.log('Triggering GitHub Actions deploy...');
  
  if (!GITHUB_CONFIG.token) {
    console.error('❌ GITHUB_TOKEN environment variable not set');
    console.error('Create a personal access token with repo permissions:');
    console.error('https://github.com/settings/tokens');
    return false;
  }
  
  try {
    // Using GitHub CLI (preferred method)
    const command = `gh workflow run ${GITHUB_CONFIG.workflow} --repo ${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}`;
    await execAsync(command, {
      env: {
        ...process.env,
        GITHUB_TOKEN: GITHUB_CONFIG.token
      }
    });
    
    console.log('✅ Deploy triggered successfully');
    return true;
  } catch (error) {
    console.error('❌ Failed to trigger deploy:', error.message);
    
    // Fallback: direct API call
    try {
      const apiCommand = `curl -X POST \\
        -H "Authorization: token ${GITHUB_CONFIG.token}" \\
        -H "Accept: application/vnd.github.v3+json" \\
        https://api.github.com/repos/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/actions/workflows/${GITHUB_CONFIG.workflow}/dispatches \\
        -d '{"ref":"main"}'`;
      
      await execAsync(apiCommand);
      console.log('✅ Deploy triggered via API');
      return true;
    } catch (apiError) {
      console.error('❌ API fallback also failed:', apiError.message);
      return false;
    }
  }
}

// Enhanced Git operations with deploy trigger
export async function gitPushAndDeploy(commitMessage = 'Update RSS feeds (local fetch)') {
  console.log('\n=== Git Push and Deploy ===');
  
  try {
    // Stage and commit
    await execAsync('git add data/articles.json data/articles-archive.json');
    
    const { stdout: status } = await execAsync('git status --porcelain');
    if (!status.trim()) {
      console.log('No changes to commit');
      return false;
    }
    
    await execAsync(`git commit -m "${commitMessage} - ${new Date().toISOString()}"`);
    console.log('✅ Changes committed');
    
    // Push to GitHub
    await execAsync('git push');
    console.log('✅ Pushed to GitHub');
    
    // Wait a moment for GitHub to process
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Trigger deploy
    const deploySuccess = await triggerDeploy();
    
    if (deploySuccess) {
      console.log('🚀 Deploy pipeline started');
      console.log('Visit your GitHub Actions tab to monitor progress');
    } else {
      console.log('⚠️  Manual deploy trigger failed - site will update on next commit');
    }
    
    return true;
  } catch (error) {
    console.error('❌ Git operation failed:', error.message);
    return false;
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  triggerDeploy()
    .then(success => process.exit(success ? 0 : 1))
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}