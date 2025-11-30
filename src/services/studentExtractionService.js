
const openaiVisionParser = require('./openaiVisionParser');

/**
 * Extract student information from answer sheet PDF
 * @param {string} answerSheetPdfUrl - URL to the answer sheet PDF
 * @param {object} assessmentContext - Context about the assessment
 * @returns {object} Extracted student information
 */
async function extractStudentInfo(answerSheetPdfUrl, assessmentContext) {
    try {
        console.log(`📋 Extracting student info from answer sheet...`);

        // HARDCODED RESPONSE FOR TESTING
        // Set to false to use real AI
        const USE_HARDCODED_RESPONSE = false;

        if (USE_HARDCODED_RESPONSE) {
            console.log(`⚠️  Using hardcoded student extraction response for testing`);
            
            // Simulate AI processing delay
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            const studentInfo = {
                student_name: "Ravi Kumar",
                student_identifier: "2024-ADM-001",
                roll_number: "15",
                class: assessmentContext.className,
                subject: assessmentContext.subject
            };

            console.log(`✅ Student info extracted (hardcoded):`, studentInfo);
            return studentInfo;
        }

        // Original AI extraction code
        const prompt = buildStudentExtractionPrompt(assessmentContext);
        const response = await openaiVisionParser.parseWithVision([answerSheetPdfUrl], prompt);

        // Parse response (handles both tuple and legacy object format)
        let studentInfo;
        try {
            const jsonMatch = response.match(/```json\n?([\s\S]*?)\n?```/) ||
                            response.match(/```\n?([\s\S]*?)\n?```/) ||
                            response.match(/\[[\s\S]*?\]/) ||
                            response.match(/\{[\s\S]*\}/);
            
            const jsonString = jsonMatch ? jsonMatch[1] || jsonMatch[0] : response;
            const parsed = JSON.parse(jsonString);

            // Handle tuple format: [student_name, student_identifier, roll_number, class]
            if (Array.isArray(parsed)) {
                const [student_name, student_identifier, roll_number, class_name] = parsed;
                studentInfo = {
                    student_name: student_name || null,
                    student_identifier: student_identifier || null,
                    roll_number: roll_number || null,
                    subject: assessmentContext.subject,
                    class: class_name || assessmentContext.className
                };
            } else {
                // Legacy object format (for backward compatibility)
                studentInfo = parsed;
            }

            console.log(`✅ Student info extracted:`, studentInfo);
            return studentInfo;

        } catch (parseError) {
            console.error('❌ Failed to parse student extraction response:', parseError);
            console.error('Raw response:', response);
            throw new Error('Failed to parse student information: ' + parseError.message);
        }

    } catch (error) {
        console.error('❌ Student extraction error:', error);
        throw error;
    }
}

/**
 * Build the student extraction prompt
 */
function buildStudentExtractionPrompt(assessmentContext) {
    const { assessmentTitle, className, subject } = assessmentContext;

    return `You are extracting student information from an answer sheet PDF.

**Assessment Context:**
- Assessment Name: ${assessmentTitle}
- Class: ${className}
- Subject: ${subject}

**Instructions:**
Analyze the answer sheet carefully and extract the following student information that is typically written at the top of the answer sheet:

1. Student Name - Full name of the student
2. Student Identifier - Permanent ID like enrollment number, admission number, or student ID
3. Roll Number - Current roll number or seat number for this exam
4. Class - Class/Grade written on the answer sheet (should match: ${className})

**Output Format:**
Return as tuple (NOT object) to save tokens:

["Ravi Kumar", "2024-ADM-001", "15", "Class 10"]

Format: [student_name, student_identifier, roll_number, class]

**Important:**
- Return ONLY the array tuple, no additional text or markdown
- Use null for any field that cannot be found or is unclear
- Maintain the exact order shown above
- student_identifier should be the permanent enrollment/admission number
- class should match the assessment class: ${className}
- If multiple formats of student ID exist (e.g., both admission number and roll number), prefer the permanent admission/enrollment number for student_identifier`;
}

module.exports = {
    extractStudentInfo
};
